import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let schemaPromise;
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

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
    CREATE TABLE IF NOT EXISTS "equipment_identities" (
      "id" TEXT PRIMARY KEY,
      "code" TEXT NOT NULL UNIQUE,
      "name" TEXT NOT NULL,
      "category" TEXT NOT NULL DEFAULT '',
      "tag_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "created_by_id" INTEGER,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch((error) => { schemaPromise = null; throw error; });
  return schemaPromise;
}

const mapItem = (row) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  category: row.category || "",
  tagIds: Array.isArray(row.tag_ids) ? row.tag_ids.map(String) : [],
  createdAt: row.created_at,
});

export async function GET(request) {
  try {
    if (!await currentUser(request)) return json({ error: "unauthorized" }, 401);
    await ensureSchema();
    const rows = await prisma.$queryRaw`SELECT * FROM "equipment_identities" ORDER BY "created_at" DESC, "code" ASC`;
    return json({ items: rows.map(mapItem) });
  } catch (error) {
    console.error("equipment_identities_get_failed", error);
    return json({ error: "equipment_identities_get_failed" }, 500);
  }
}

export async function POST(request) {
  try {
    const user = await currentUser(request);
    if (!user) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const code = String(body.code || "").trim().slice(0, 80);
    const name = String(body.name || "").trim().slice(0, 255);
    const category = String(body.category || "").trim().slice(0, 120);
    const tagIds = [...new Set((Array.isArray(body.tagIds) ? body.tagIds : []).map(String).filter(Boolean))].slice(0, 100);
    if (!code || !name) return json({ error: "code_and_name_required" }, 400);
    await ensureSchema();
    const rows = await prisma.$queryRaw`
      INSERT INTO "equipment_identities" ("id", "code", "name", "category", "tag_ids", "created_by_id")
      VALUES (${randomUUID()}, ${code}, ${name}, ${category}, ${JSON.stringify(tagIds)}::jsonb, ${Number(user.id)})
      RETURNING *
    `;
    return json({ item: mapItem(rows[0]) }, 201);
  } catch (error) {
    if (error?.code === "23505" || error?.meta?.code === "23505") return json({ error: "duplicate_code" }, 409);
    console.error("equipment_identities_post_failed", error);
    return json({ error: "equipment_identities_post_failed" }, 500);
  }
}
