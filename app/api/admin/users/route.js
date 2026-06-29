// app/api/admin/users/route.js
export const runtime = "nodejs";

import { prisma } from "../../../../lib/prisma";
import bcrypt from "bcryptjs";

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function ensureIntArray(v) {
  const arr = Array.isArray(v) ? v : v == null ? [] : [v];
  return Array.from(new Set(arr.map(Number).filter((n) => Number.isFinite(n) && n > 0)));
}

async function getUnitIdsForUser(userId) {
  const rows = await prisma.userUnit.findMany({
    where: { userId },
    select: { unitId: true },
  });
  return Array.from(new Set((rows || []).map((r) => r.unitId).filter(Boolean)));
}

async function replaceUserUnits(userId, unitIds) {
  await prisma.userUnit.deleteMany({ where: { userId } });
  if (unitIds.length) {
    await prisma.userUnit.createMany({
      data: unitIds.map((unitId) => ({ userId, unitId })),
      skipDuplicates: true,
    });
  }
}

function readExpiresAtInput(body) {
  if (Object.prototype.hasOwnProperty.call(body, "expiresAt")) return body.expiresAt;
  if (Object.prototype.hasOwnProperty.call(body, "expires_at")) return body.expires_at;
  if (Object.prototype.hasOwnProperty.call(body, "validUntil")) return body.validUntil;
  if (Object.prototype.hasOwnProperty.call(body, "valid_until")) return body.valid_until;
  return undefined;
}

function parseExpiresAtInput(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const raw = String(v || "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    const err = new Error("invalid_expires_at");
    err.status = 400;
    throw err;
  }
  return d;
}

async function mapUser(u) {
  if (!u) return null;
  const roles = hasUserField("roles") && Array.isArray(u.roles) ? u.roles : [];
  const unitIds = await getUnitIdsForUser(u.id);

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    username: u.username,
    department: u.department,
    role: u.role,
    expiresAt: u.expiresAt ? new Date(u.expiresAt).toISOString() : null,
    access: u.access || [],
    access_labels: u.access || [],
    unitIds,
    positions: roles.map((link) => ({ id: link.role.id, name: link.role.name })),
  };
}

async function hashPasswordIfProvided(pw) {
  const p = String(pw || "");
  if (!p) return null;
  return await bcrypt.hash(p, 10);
}

function userScalarFieldNames() {
  const fields = prisma?._runtimeDataModel?.models?.User?.fields || [];
  return new Set(fields.filter((f) => f?.kind === "scalar").map((f) => f.name));
}

function userFieldNames() {
  const fields = prisma?._runtimeDataModel?.models?.User?.fields || [];
  return new Set(fields.map((f) => f.name));
}

function hasUserScalarField(name) {
  return userScalarFieldNames().has(name);
}

function hasUserField(name) {
  return userFieldNames().has(name);
}

function setUserScalarData(data, name, value) {
  if (hasUserScalarField(name)) data[name] = value;
}

function userQueryArgs() {
  return hasUserField("roles") ? { include: { roles: { include: { role: true } } } } : {};
}

function userPasswordFieldName() {
  const fields = userScalarFieldNames();
  if (fields.has("password")) return "password";
  if (fields.has("passwordHash")) return "passwordHash";
  return "password";
}

function setPasswordData(data, passwordHash) {
  if (!passwordHash) return;
  data[userPasswordFieldName()] = passwordHash;
}

function quoteIdent(v) {
  return `"${String(v || "").replace(/"/g, '""')}"`;
}

async function rawPasswordColumnRef() {
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
    LIMIT 1
  `;
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.table_schema || !row?.table_name || !row?.column_name) return null;
  return {
    schema: String(row.table_schema),
    table: String(row.table_name),
    column: String(row.column_name),
  };
}

async function updatePasswordRaw(userId, passwordHash) {
  const ref = await rawPasswordColumnRef();
  if (!ref) {
    const err = new Error("password_column_not_found");
    err.status = 500;
    throw err;
  }
  const table = `${quoteIdent(ref.schema)}.${quoteIdent(ref.table)}`;
  const column = quoteIdent(ref.column);
  await prisma.$executeRawUnsafe(`UPDATE ${table} SET ${column} = $1 WHERE "id" = $2`, passwordHash, userId);
}

function unknownArgumentName(e) {
  const msg = String(e?.message || "");
  const m = msg.match(/Unknown argument `([^`]+)`/);
  return m?.[1] || "";
}

async function updateUserRetryingUnknownFields(id, data, rolesUpdate) {
  const safeData = { ...(data || {}) };
  let safeRolesUpdate = rolesUpdate;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      return await prisma.user.update({
        where: { id },
        data: { ...safeData, ...(safeRolesUpdate ? { roles: safeRolesUpdate } : {}) },
        ...userQueryArgs(),
      });
    } catch (e) {
      const unknown = unknownArgumentName(e);
      if (!unknown) throw e;
      if (unknown === "roles") {
        safeRolesUpdate = undefined;
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(safeData, unknown)) throw e;
      delete safeData[unknown];
    }
  }

  const err = new Error("user_update_schema_mismatch");
  err.status = 500;
  throw err;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get("id");

    if (idParam) {
      const id = Number(idParam);
      if (!id || Number.isNaN(id)) {
        return new Response(JSON.stringify({ error: "invalid_id", message: "شناسه نامعتبر است" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      const user = await prisma.user.findUnique({
        where: { id },
        ...userQueryArgs(),
      });

      if (!user) {
        return new Response(JSON.stringify({ error: "not_found", message: "کاربر پیدا نشد" }), {
          status: 404, headers: { "Content-Type": "application/json" },
        });
      }

      return Response.json({ user: await mapUser(user) });
    }

    const users = await prisma.user.findMany({
      orderBy: { id: "asc" },
      ...userQueryArgs(),
    });

    const out = [];
    for (const u of users) out.push(await mapUser(u));
    return Response.json({ users: out });
  } catch (e) {
    console.error("admin_users_get_error", e);
    return new Response(JSON.stringify({ error: "internal_error", message: e?.message || "unknown_error", code: e?.code || null }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}

export async function POST(request) {
  try {
    const body = await readJson(request);

    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!username || !password) {
      return new Response(JSON.stringify({ error: "username_password_required", message: "نام کاربری و گذرواژه الزامی است" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const name = body.name ? String(body.name).trim() : null;
    const email = body.email ? String(body.email).trim() : null;
    const department = body.department ? String(body.department).trim() : null;
    const role = body.role ? String(body.role).trim() : "user";
    const expiresAt = parseExpiresAtInput(readExpiresAtInput(body));

    const access = Array.isArray(body.access) ? body.access.map((v) => String(v || "")) : [];

    const rawRoleIds =
      Array.isArray(body.positions) && body.positions.length ? body.positions :
      Array.isArray(body.roles) && body.roles.length ? body.roles : [];
    const roleIds = rawRoleIds.map((v) => Number(v)).filter((v) => !Number.isNaN(v) && v > 0);

    const unitIds = ensureIntArray(body.unitIds ?? body.unit_ids ?? body.units ?? []);

    const passwordHash = await hashPasswordIfProvided(password);
    const userData = {};
    setUserScalarData(userData, "name", name);
    setUserScalarData(userData, "email", email);
    setUserScalarData(userData, "username", username);
    setUserScalarData(userData, "department", department);
    setUserScalarData(userData, "role", role);
    setUserScalarData(userData, "access", access);
    if (expiresAt !== undefined) setUserScalarData(userData, "expiresAt", expiresAt);
    if (hasUserField("roles")) {
      userData.roles = { create: roleIds.map((roleId) => ({ role: { connect: { id: roleId } } })) };
    }
    setPasswordData(userData, passwordHash);

    const user = await prisma.user.create({
      data: userData,
      ...userQueryArgs(),
    });

    await replaceUserUnits(user.id, unitIds);

    return Response.json({ user: await mapUser(user) });
  } catch (e) {
    console.error("admin_users_post_error", e);
    return new Response(JSON.stringify({ error: e?.message || "internal_error", message: e?.message || "unknown_error", code: e?.code || null }), {
      status: e?.status || 500, headers: { "Content-Type": "application/json" },
    });
  }
}

export async function PATCH(request) {
  try {
    const body = await readJson(request);

    const id = Number(body.id);
    if (!id || Number.isNaN(id)) {
      return new Response(JSON.stringify({ error: "invalid_id", message: "شناسه نامعتبر است" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const data = {};

    if (body.name !== undefined) setUserScalarData(data, "name", body.name === null ? null : (String(body.name || "").trim() || null));
    if (body.email !== undefined) setUserScalarData(data, "email", body.email === null ? null : (String(body.email || "").trim() || null));
    if (body.username !== undefined) setUserScalarData(data, "username", String(body.username || "").trim());
    if (body.department !== undefined) setUserScalarData(data, "department", body.department === null ? null : (String(body.department || "").trim() || null));
    if (body.role !== undefined) setUserScalarData(data, "role", String(body.role || "user").trim());
    const expiresAt = parseExpiresAtInput(readExpiresAtInput(body));
    if (expiresAt !== undefined) setUserScalarData(data, "expiresAt", expiresAt);

    const passwordHash = body.password ? await hashPasswordIfProvided(body.password) : null;

    if (Array.isArray(body.access)) setUserScalarData(data, "access", body.access.map((v) => String(v || "")));

    const rawRoleIds =
      Array.isArray(body.positions) && body.positions.length ? body.positions :
      Array.isArray(body.roles) && body.roles.length ? body.roles : null;

    let rolesUpdate = undefined;
    if (rawRoleIds !== null && hasUserField("roles")) {
      const roleIds = rawRoleIds.map((v) => Number(v)).filter((v) => !Number.isNaN(v) && v > 0);
      rolesUpdate = { deleteMany: {}, create: roleIds.map((roleId) => ({ role: { connect: { id: roleId } } })) };
    }

    const user = await updateUserRetryingUnknownFields(id, data, rolesUpdate);

    if (passwordHash) await updatePasswordRaw(id, passwordHash);

    if (body.unitIds !== undefined || body.unit_ids !== undefined || body.units !== undefined) {
      const unitIds = ensureIntArray(body.unitIds ?? body.unit_ids ?? body.units ?? []);
      await replaceUserUnits(id, unitIds);
    }

    return Response.json({ user: await mapUser(user) });
  } catch (e) {
    console.error("admin_users_patch_error", e);
    return new Response(JSON.stringify({ error: e?.message || "internal_error", message: e?.message || "unknown_error", code: e?.code || null }), {
      status: e?.status || 500, headers: { "Content-Type": "application/json" },
    });
  }
}

export async function DELETE(request) {
  try {
    const body = await readJson(request);
    const id = Number(body.id);
    if (!id || Number.isNaN(id)) {
      return new Response(JSON.stringify({ error: "invalid_id", message: "شناسه نامعتبر است" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    await prisma.userRoleMap.deleteMany({ where: { userId: id } });
    await prisma.userUnit.deleteMany({ where: { userId: id } });

    const deleted = await prisma.user.delete({
      where: { id },
      ...userQueryArgs(),
    });

    return Response.json({ ok: true, user: await mapUser({ ...deleted, roles: [] }) });
  } catch (e) {
    console.error("admin_users_delete_error", e);
    return new Response(JSON.stringify({ error: "internal_error", message: e?.message || "unknown_error", code: e?.code || null }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
