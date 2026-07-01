// app/api/base/user-role-assignments/route.js
export const runtime = "nodejs";

import { prisma } from "../../../../lib/prisma";

async function readJson(request) {
  try {
    const text = await request.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function ensureUserRoleMapTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "UserRoleMap" (
      "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "roleId" INTEGER NOT NULL REFERENCES "UserRole"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "UserRoleMap_pkey" PRIMARY KEY ("userId", "roleId")
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "UserRoleMap_roleId_idx" ON "UserRoleMap"("roleId")
  `);
}

function userLabel(user) {
  return String(user?.name || user?.username || user?.email || `کاربر ${user?.id || ""}`).trim();
}

function mapRows(rows) {
  const byUserId = new Map();

  for (const row of rows || []) {
    const userId = Number(row.user_id);
    if (!userId) continue;

    if (!byUserId.has(userId)) {
      const user = {
        id: userId,
        name: row.user_name,
        username: row.username,
        email: row.email,
      };
      byUserId.set(userId, {
        ...user,
        label: userLabel(user),
        roles: [],
      });
    }

    if (row.role_id) {
      byUserId.get(userId).roles.push({
        id: Number(row.role_id),
        name: row.role_name,
      });
    }
  }

  return Array.from(byUserId.values());
}

async function getAssignmentItems(userId = null) {
  await ensureUserRoleMapTable();

  const rows = userId
    ? await prisma.$queryRaw`
        SELECT
          u."id" AS user_id,
          u."name" AS user_name,
          u."username" AS username,
          u."email" AS email,
          r."id" AS role_id,
          r."name" AS role_name
        FROM "User" u
        LEFT JOIN "UserRoleMap" urm ON urm."userId" = u."id"
        LEFT JOIN "UserRole" r ON r."id" = urm."roleId"
        WHERE u."id" = ${Number(userId)}
        ORDER BY u."id" ASC, r."name" ASC
      `
    : await prisma.$queryRaw`
        SELECT
          u."id" AS user_id,
          u."name" AS user_name,
          u."username" AS username,
          u."email" AS email,
          r."id" AS role_id,
          r."name" AS role_name
        FROM "User" u
        LEFT JOIN "UserRoleMap" urm ON urm."userId" = u."id"
        LEFT JOIN "UserRole" r ON r."id" = urm."roleId"
        ORDER BY u."id" ASC, r."name" ASC
      `;

  return mapRows(rows);
}

export async function GET() {
  try {
    const [items, roles] = await Promise.all([
      getAssignmentItems(),
      prisma.userRole.findMany({ orderBy: { name: "asc" } }),
    ]);

    return Response.json({
      ok: true,
      items,
      users: items.map((u) => ({
        id: u.id,
        name: u.name,
        username: u.username,
        email: u.email,
        label: u.label,
      })),
      roles,
    });
  } catch (e) {
    console.error("user_role_assignments_get_error", e);
    return new Response(JSON.stringify({ error: e?.message || "internal_error" }), {
      status: e?.status || 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function POST(request) {
  try {
    await ensureUserRoleMapTable();
    const body = await readJson(request);
    const userId = Number(body.user_id ?? body.userId);
    const roleId = Number(body.role_id ?? body.roleId);

    if (!userId || !Number.isFinite(userId)) {
      return new Response(JSON.stringify({ error: "user_required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!roleId || !Number.isFinite(roleId)) {
      return new Response(JSON.stringify({ error: "role_required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const [user, role] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.userRole.findUnique({ where: { id: roleId } }),
    ]);
    if (!user) {
      return new Response(JSON.stringify({ error: "user_not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!role) {
      return new Response(JSON.stringify({ error: "role_not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    await prisma.$executeRaw`
      INSERT INTO "UserRoleMap" ("userId", "roleId")
      VALUES (${userId}, ${roleId})
      ON CONFLICT ("userId", "roleId") DO NOTHING
    `;

    const item = (await getAssignmentItems(userId))[0] || null;
    return Response.json({ ok: true, item, user, role });
  } catch (e) {
    console.error("user_role_assignments_post_error", e);
    return new Response(JSON.stringify({ error: e?.message || "internal_error" }), {
      status: e?.status || 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function DELETE(request) {
  try {
    await ensureUserRoleMapTable();
    const body = await readJson(request);
    const userId = Number(body.user_id ?? body.userId);
    const roleId = Number(body.role_id ?? body.roleId);

    if (!userId || !Number.isFinite(userId)) {
      return new Response(JSON.stringify({ error: "user_required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (roleId && Number.isFinite(roleId)) {
      await prisma.$executeRaw`
        DELETE FROM "UserRoleMap"
        WHERE "userId" = ${userId} AND "roleId" = ${roleId}
      `;
    } else {
      await prisma.$executeRaw`
        DELETE FROM "UserRoleMap"
        WHERE "userId" = ${userId}
      `;
    }

    return Response.json({ ok: true });
  } catch (e) {
    console.error("user_role_assignments_delete_error", e);
    return new Response(JSON.stringify({ error: e?.message || "internal_error" }), {
      status: e?.status || 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
