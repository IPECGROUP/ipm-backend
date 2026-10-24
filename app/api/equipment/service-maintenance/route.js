import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
let schemaPromise;

async function currentUser(request) {
  const cookie = request.headers.get("cookie") || "";
  const token = cookie.match(/(?:^|;\s*)ipm_session=([^;]+)/)?.[1];
  if (token) {
    const session = await prisma.session.findUnique({ where: { id: decodeURIComponent(token) }, include: { user: true } }).catch(() => null);
    if (session?.user && (!session.expiresAt || new Date(session.expiresAt) >= new Date())) return session.user;
  }
  const headerId = request.headers.get("x-user-id");
  if (process.env.NODE_ENV !== "production" && /^\d+$/.test(headerId || "")) return { id: Number(headerId) };
  return null;
}

async function ensureSchema() {
  if (!schemaPromise) schemaPromise = prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "equipment_service_maintenance" (
      "id" TEXT PRIMARY KEY,
      "equipment_id" TEXT NOT NULL,
      "service_date" TEXT NOT NULL,
      "created_by_id" INTEGER,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch((error) => { schemaPromise = null; throw error; });
  return schemaPromise;
}

const mapItem = (row) => ({
  id: row.id,
  equipmentId: row.equipment_id,
  serviceDate: row.service_date,
  createdAt: row.created_at,
});

export async function GET(request) {
  try {
    if (!await currentUser(request)) return json({ error: "unauthorized" }, 401);
    await ensureSchema();
    const rows = await prisma.$queryRaw`SELECT * FROM "equipment_service_maintenance" ORDER BY "created_at" DESC, "id" DESC`;
    return json({ items: rows.map(mapItem) });
  } catch (error) {
    console.error("equipment_service_maintenance_get_failed", error);
    return json({ error: "equipment_service_maintenance_get_failed" }, 500);
  }
}

export async function POST(request) {
  try {
    const user = await currentUser(request);
    if (!user) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const equipmentId = String(body.equipmentId || "");
    const serviceDate = String(body.serviceDate || "").replaceAll("-", "/");
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(equipmentId) || !/^\d{4}\/(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])$/.test(serviceDate)) {
      return json({ error: "invalid_service_data" }, 400);
    }
    await ensureSchema();
    const equipment = await prisma.$queryRaw`SELECT id FROM "equipment_identities" WHERE id = ${equipmentId}`;
    if (!equipment.length) return json({ error: "equipment_not_found" }, 400);
    const rows = await prisma.$queryRaw`
      INSERT INTO "equipment_service_maintenance" ("id", "equipment_id", "service_date", "created_by_id")
      VALUES (${randomUUID()}, ${equipmentId}, ${serviceDate}, ${Number(user.id)})
      RETURNING *
    `;
    return json({ item: mapItem(rows[0]) }, 201);
  } catch (error) {
    console.error("equipment_service_maintenance_post_failed", error);
    return json({ error: "equipment_service_maintenance_post_failed" }, 500);
  }
}
