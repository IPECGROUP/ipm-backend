import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { ensureEquipmentFieldTables } from "../../../lib/equipmentFieldsSchema";
import { ensureEquipmentSpecificationsTable } from "../../../lib/equipmentSpecificationsSchema";

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
  if (!schemaPromise) schemaPromise = (async () => {
    await ensureEquipmentSpecificationsTable();
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "equipment_identities" (
      "id" TEXT PRIMARY KEY,
      "code" TEXT NOT NULL UNIQUE,
      "name" TEXT NOT NULL,
      "category" TEXT NOT NULL DEFAULT '',
      "tag_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "category_id" INTEGER REFERENCES equipment_field_categories(id) ON DELETE RESTRICT,
      "field_values" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "related_letter_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "files" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "created_by_id" INTEGER,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    `);
    await prisma.$executeRawUnsafe(`ALTER TABLE equipment_identities ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES equipment_field_categories(id) ON DELETE RESTRICT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE equipment_identities ADD COLUMN IF NOT EXISTS field_values JSONB NOT NULL DEFAULT '{}'::jsonb`);
    await prisma.$executeRawUnsafe(`ALTER TABLE equipment_identities ADD COLUMN IF NOT EXISTS related_letter_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await prisma.$executeRawUnsafe(`ALTER TABLE equipment_identities ADD COLUMN IF NOT EXISTS files JSONB NOT NULL DEFAULT '[]'::jsonb`);
  })().catch((error) => { schemaPromise = null; throw error; });
  return schemaPromise;
}

const mapItem = (row) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  category: row.category || "",
  categoryId: row.category_id,
  fieldValues: row.field_values && typeof row.field_values === "object" && !Array.isArray(row.field_values) ? row.field_values : {},
  relatedLetterIds: Array.isArray(row.related_letter_ids) ? row.related_letter_ids.map(String) : [],
  files: Array.isArray(row.files) ? row.files : [],
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
    const categoryId = Number(body.categoryId);
    const tagIds = [...new Set((Array.isArray(body.tagIds) ? body.tagIds : []).map(String).filter(Boolean))].slice(0, 100);
    if (!Number.isSafeInteger(categoryId) || categoryId < 1) return json({ error: "category_required" }, 400);
    await ensureSchema();
    const categories = await prisma.$queryRaw`SELECT name FROM equipment_field_categories WHERE id = ${categoryId}`;
    if (!categories.length) return json({ error: "category_not_found" }, 400);
    const id = randomUUID();
    const code = String(body.code || "").trim().slice(0, 80) || `EQ-${id}`;
    const name = String(body.name || "").trim().slice(0, 255) || `تجهیز ${categories[0].name}`;
    const definitions = await prisma.$queryRaw`SELECT id FROM equipment_field_definitions WHERE category_id = ${categoryId}`;
    const allowedFieldIds = new Set(definitions.map((field) => String(field.id)));
    const specifications = await prisma.$queryRaw`SELECT id FROM equipment_specifications WHERE category_id = ${categoryId}`;
    specifications.forEach((item) => allowedFieldIds.add(`spec:${item.id}`));
    const suppliedValues = body.fieldValues && typeof body.fieldValues === "object" && !Array.isArray(body.fieldValues) ? body.fieldValues : {};
    if (Object.keys(suppliedValues).some((id) => !allowedFieldIds.has(id) || typeof suppliedValues[id] !== "string" || suppliedValues[id].length > 10000)) return json({ error: "invalid_field_values" }, 400);
    const fieldValues = Object.fromEntries(Object.entries(suppliedValues).map(([id, value]) => [id, value.trim()]));
    const relatedLetterIds = [...new Set((Array.isArray(body.relatedLetterIds) ? body.relatedLetterIds : []).map(String))].filter((id) => /^\d+$/.test(id)).slice(0, 200);
    const files = (Array.isArray(body.files) ? body.files : []).slice(0, 100).map((file) => ({
      name: String(file?.name || "").slice(0, 180),
      url: String(file?.url || ""),
      size: Number(file?.size || 0),
      type: String(file?.type || "").slice(0, 120),
    }));
    if (files.some((file) => !/^\/uploads\/equipment-identities\/[a-f0-9-]{36}\.[a-z0-9]+$/.test(file.url) || !Number.isFinite(file.size) || file.size < 0)) return json({ error: "invalid_files" }, 400);
    const rows = await prisma.$queryRaw`
      INSERT INTO "equipment_identities" ("id", "code", "name", "category", "category_id", "tag_ids", "field_values", "related_letter_ids", "files", "created_by_id")
      VALUES (${id}, ${code}, ${name}, ${categories[0].name}, ${categoryId}, ${JSON.stringify(tagIds)}::jsonb, ${JSON.stringify(fieldValues)}::jsonb, ${JSON.stringify(relatedLetterIds)}::jsonb, ${JSON.stringify(files)}::jsonb, ${Number(user.id)})
      RETURNING *
    `;
    return json({ item: mapItem(rows[0]) }, 201);
  } catch (error) {
    if (error?.code === "23505" || error?.meta?.code === "23505") return json({ error: "duplicate_code" }, 409);
    console.error("equipment_identities_post_failed", error);
    return json({ error: "equipment_identities_post_failed" }, 500);
  }
}
