// app/api/admin/users/password/route.js
export const runtime = "nodejs";

import { prisma } from "../../../../../lib/prisma";
import bcrypt from "bcryptjs";
import { isSuperAdmin, requireAdmin } from "../../../../../lib/security";
import { writeAuditLog } from "../../../../../lib/auditLog";

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function quoteIdent(v) {
  return `"${String(v || "").replace(/"/g, '""')}"`;
}

async function findUserPasswordTarget(userId) {
  const rows = await prisma.$queryRaw`
    SELECT
      c.table_schema::text AS table_schema,
      c.table_name::text AS table_name,
      c.column_name::text AS column_name
    FROM information_schema.columns c
    WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
      AND c.column_name IN ('password', 'passwordHash', 'password_hash')
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns idc
        WHERE idc.table_schema = c.table_schema
          AND idc.table_name = c.table_name
          AND idc.column_name = 'id'
      )
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns uc
        WHERE uc.table_schema = c.table_schema
          AND uc.table_name = c.table_name
          AND uc.column_name IN ('username', 'email')
      )
    ORDER BY
      CASE WHEN c.table_schema = current_schema() THEN 0 ELSE 1 END,
      CASE c.table_name WHEN 'User' THEN 0 WHEN 'users' THEN 1 WHEN 'user' THEN 2 ELSE 3 END,
      CASE c.column_name WHEN 'password' THEN 0 WHEN 'passwordHash' THEN 1 WHEN 'password_hash' THEN 2 ELSE 3 END
  `;

  for (const row of rows || []) {
    const schema = String(row.table_schema || "");
    const tableName = String(row.table_name || "");
    const columnName = String(row.column_name || "");
    if (!schema || !tableName || !columnName) continue;

    const countRows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM ${quoteIdent(schema)}.${quoteIdent(tableName)} WHERE "id" = $1`,
      userId
    );
    if (Number(countRows?.[0]?.count || 0) > 0) {
      return { schema, tableName, columnName };
    }
  }

  return null;
}

async function updatePassword(userId, passwordHash) {
  const target = await findUserPasswordTarget(userId);
  if (!target) {
    const err = new Error("user_password_target_not_found");
    err.status = 404;
    throw err;
  }

  const table = `${quoteIdent(target.schema)}.${quoteIdent(target.tableName)}`;
  const column = quoteIdent(target.columnName);
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE ${table} SET ${column} = $1 WHERE "id" = $2`,
    passwordHash,
    userId
  );

  if (!updated) {
    const err = new Error("user_not_found");
    err.status = 404;
    throw err;
  }
}

export async function PATCH(request) {
  const auth = await requireAdmin(request);
  if (auth.denied) return auth.denied;
  try {
    const body = await readJson(request);
    const id = Number(body.id);
    const password = String(body.password || "");

    if (!id || Number.isNaN(id)) return json({ error: "invalid_id" }, 400);
    if (password.length < 6) return json({ error: "password_too_short" }, 400);
    if (Buffer.byteLength(password, "utf8") > 72) return json({ error: "password_too_long" }, 400);

    const targetUser = await prisma.user.findUnique({ where: { id } });
    if (!targetUser) return json({ error: "user_not_found" }, 404);
    if (isSuperAdmin(targetUser)) {
      await writeAuditLog({ request, actor: auth.user, action: "user.password_change", entityType: "user", entityId: id, status: "blocked", severity: "warning", details: { reason: "protected_super_admin" } });
      return json({ error: "protected_super_admin" }, 403);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await updatePassword(id, passwordHash);
    await prisma.session.deleteMany({ where: { userId: id } });

    await writeAuditLog({ request, actor: auth.user, action: "user.password_change", entityType: "user", entityId: id, severity: "warning", details: { targetUsername: targetUser.username, sessionsRevoked: true } });

    return json({ ok: true });
  } catch (e) {
    console.error("admin_user_password_patch_error", e);
    await writeAuditLog({ request, actor: auth.user, action: "user.password_change", status: "failure", severity: "error", details: { reason: e?.message || "internal_error" } });
    return json({ error: e?.status === 404 ? "user_not_found" : "internal_error" }, e?.status || 500);
  }
}
