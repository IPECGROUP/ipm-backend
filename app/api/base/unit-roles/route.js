// app/api/base/unit-roles/route.js
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

const normalize = (value) => String(value || "").trim();

async function ensureUnitRoleMapTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "UnitRoleMap" (
      "unitId" INTEGER NOT NULL REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "roleId" INTEGER NOT NULL REFERENCES "UserRole"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "UnitRoleMap_pkey" PRIMARY KEY ("unitId", "roleId")
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "UnitRoleMap_roleId_idx" ON "UnitRoleMap"("roleId")
  `);
}

async function resolveUnit({ unitId, unitName }) {
  const id = Number(unitId);
  if (id && Number.isFinite(id)) {
    const unit = await prisma.unit.findUnique({ where: { id } });
    if (!unit) throw Object.assign(new Error("unit_not_found"), { status: 404 });
    return unit;
  }

  const name = normalize(unitName);
  if (!name) throw Object.assign(new Error("unit_required"), { status: 400 });

  const existing = await prisma.unit.findFirst({ where: { name } });
  if (existing) return existing;

  return prisma.unit.create({ data: { name } });
}

async function resolveRole({ roleId, roleName }) {
  const id = Number(roleId);
  if (id && Number.isFinite(id)) {
    const role = await prisma.userRole.findUnique({ where: { id } });
    if (!role) throw Object.assign(new Error("role_not_found"), { status: 404 });
    return role;
  }

  const name = normalize(roleName);
  if (!name) throw Object.assign(new Error("role_required"), { status: 400 });

  return prisma.userRole.upsert({
    where: { name },
    update: {},
    create: { name },
  });
}

function mapUnit(unit) {
  return {
    id: unit.id,
    name: unit.name,
    label: unit.name,
    code: unit.code,
    roles: (unit.roles || [])
      .map((row) => row.role)
      .filter(Boolean)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "fa", { numeric: true })),
  };
}

function mapUnitRoleRows(rows) {
  const byUnitId = new Map();

  for (const row of rows || []) {
    const unitId = Number(row.unit_id);
    if (!unitId) continue;

    if (!byUnitId.has(unitId)) {
      byUnitId.set(unitId, {
        id: unitId,
        name: row.unit_name,
        label: row.unit_name,
        code: row.unit_code,
        roles: [],
      });
    }

    if (row.role_id) {
      byUnitId.get(unitId).roles.push({
        id: Number(row.role_id),
        name: row.role_name,
      });
    }
  }

  return Array.from(byUnitId.values());
}

async function getUnitRoleItems(unitId = null) {
  await ensureUnitRoleMapTable();

  const rows = unitId
    ? await prisma.$queryRaw`
        SELECT
          u."id" AS unit_id,
          u."name" AS unit_name,
          u."code" AS unit_code,
          r."id" AS role_id,
          r."name" AS role_name
        FROM "Unit" u
        LEFT JOIN "UnitRoleMap" urm ON urm."unitId" = u."id"
        LEFT JOIN "UserRole" r ON r."id" = urm."roleId"
        WHERE u."id" = ${Number(unitId)}
        ORDER BY u."name" ASC, r."name" ASC
      `
    : await prisma.$queryRaw`
        SELECT
          u."id" AS unit_id,
          u."name" AS unit_name,
          u."code" AS unit_code,
          r."id" AS role_id,
          r."name" AS role_name
        FROM "Unit" u
        LEFT JOIN "UnitRoleMap" urm ON urm."unitId" = u."id"
        LEFT JOIN "UserRole" r ON r."id" = urm."roleId"
        ORDER BY u."name" ASC, r."name" ASC
      `;

  return mapUnitRoleRows(rows);
}

// GET /api/base/unit-roles
export async function GET() {
  try {
    const [items, roles] = await Promise.all([
      getUnitRoleItems(),
      prisma.userRole.findMany({ orderBy: { name: "asc" } }),
    ]);

    return Response.json({
      ok: true,
      items,
      units: items.map((u) => ({ id: u.id, name: u.name, label: u.name, code: u.code })),
      roles,
    });
  } catch (e) {
    console.error("unit_roles_get_error", e);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// POST /api/base/unit-roles
// body: { unit_id?, unit_name?, role_id?, role_name? }
// If only unit_name is provided, this creates/returns the unit without assigning a role.
export async function POST(request) {
  try {
    await ensureUnitRoleMapTable();
    const body = await readJson(request);
    const unit = await resolveUnit({
      unitId: body.unit_id ?? body.unitId,
      unitName: body.unit_name ?? body.unitName,
    });
    const hasRole =
      normalize(body.role_name ?? body.roleName) ||
      (Number(body.role_id ?? body.roleId) && Number.isFinite(Number(body.role_id ?? body.roleId)));

    if (!hasRole) {
      const item = (await getUnitRoleItems(unit.id))[0] || {
        id: unit.id,
        name: unit.name,
        label: unit.name,
        code: unit.code,
        roles: [],
      };

      return Response.json({ ok: true, item, unit, role: null });
    }

    const role = await resolveRole({
      roleId: body.role_id ?? body.roleId,
      roleName: body.role_name ?? body.roleName,
    });

    await prisma.$executeRaw`
      INSERT INTO "UnitRoleMap" ("unitId", "roleId")
      VALUES (${unit.id}, ${role.id})
      ON CONFLICT ("unitId", "roleId") DO NOTHING
    `;

    const item = (await getUnitRoleItems(unit.id))[0] || null;

    return Response.json({ ok: true, item, unit, role });
  } catch (e) {
    console.error("unit_roles_post_error", e);
    return new Response(JSON.stringify({ error: e.message || "internal_error" }), {
      status: e.status || 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// DELETE /api/base/unit-roles
// body: { unit_id, role_id? } ; omit role_id to clear all roles for a unit.
export async function DELETE(request) {
  try {
    await ensureUnitRoleMapTable();
    const body = await readJson(request);
    const unitId = Number(body.unit_id ?? body.unitId);
    const roleId = Number(body.role_id ?? body.roleId);

    if (!unitId || !Number.isFinite(unitId)) {
      return new Response(JSON.stringify({ error: "unit_required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (roleId && Number.isFinite(roleId)) {
      await prisma.$executeRaw`
        DELETE FROM "UnitRoleMap"
        WHERE "unitId" = ${unitId} AND "roleId" = ${roleId}
      `;
    } else {
      await prisma.$executeRaw`
        DELETE FROM "UnitRoleMap"
        WHERE "unitId" = ${unitId}
      `;
    }

    return Response.json({ ok: true });
  } catch (e) {
    console.error("unit_roles_delete_error", e);
    if (e.code === "P2025") {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: e.message || "internal_error" }), {
      status: e.status || 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
