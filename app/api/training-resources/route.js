import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let schemaPromise;
const json = (data, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

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
    CREATE TABLE IF NOT EXISTS "training_resources" (
      "id" TEXT PRIMARY KEY,
      "title" TEXT NOT NULL,
      "category" TEXT NOT NULL DEFAULT '',
      "link" TEXT NOT NULL,
      "related_letter_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "tag_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "files" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "created_by_id" INTEGER,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).then(() => prisma.$executeRawUnsafe(`ALTER TABLE "training_resources" ADD COLUMN IF NOT EXISTS "tag_ids" JSONB NOT NULL DEFAULT '[]'::jsonb`)).catch((error) => { schemaPromise = null; throw error; });
  return schemaPromise;
}

function mapItem(row) {
  return { id: row.id, title: row.title, category: row.category || "", link: row.link, relatedLetterIds: Array.isArray(row.related_letter_ids) ? row.related_letter_ids : [], tagIds: Array.isArray(row.tag_ids) ? row.tag_ids.map(String) : [], files: Array.isArray(row.files) ? row.files : [], createdById: row.created_by_id, createdAt: row.created_at };
}

export async function GET(request) {
  try {
    if (!await currentUser(request)) return json({ error: "unauthorized" }, 401);
    await ensureSchema();
    const rows = await prisma.$queryRaw`SELECT * FROM "training_resources" ORDER BY "created_at" DESC`;
    return json({ items: rows.map(mapItem) });
  } catch (error) {
    console.error("training_resources_get_failed", error);
    return json({ error: "training_resources_get_failed" }, 500);
  }
}

export async function POST(request) {
  try {
    const user = await currentUser(request);
    if (!user) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const title = String(body.title || "").trim().slice(0, 300);
    const category = String(body.category || "").trim().slice(0, 120);
    const rawLink = String(body.link || "").trim().slice(0, 2048);
    if (!title) return json({ error: "title_required" }, 400);
    if (!rawLink) return json({ error: "link_required" }, 400);
    const link = /^https?:\/\//i.test(rawLink) ? rawLink : `https://${rawLink}`;
    try { new URL(link); } catch { return json({ error: "invalid_link" }, 400); }
    const relatedLetterIds = (Array.isArray(body.relatedLetterIds) ? body.relatedLetterIds : []).map(String).filter(Boolean).slice(0, 100);
    const tagIds = [...new Set((Array.isArray(body.tagIds) ? body.tagIds : []).map(String).filter(Boolean))].slice(0, 100);
    const files = (Array.isArray(body.files) ? body.files : []).filter((file) => file && typeof file === "object" && file.url).slice(0, 30).map((file) => ({ name: String(file.name || "file").slice(0, 255), url: String(file.url).slice(0, 1000), size: Number(file.size || 0), type: String(file.type || "").slice(0, 120) }));
    await ensureSchema();
    const id = randomUUID();
    const rows = await prisma.$queryRaw`
      INSERT INTO "training_resources" ("id", "title", "category", "link", "related_letter_ids", "tag_ids", "files", "created_by_id")
      VALUES (${id}, ${title}, ${category}, ${link}, ${JSON.stringify(relatedLetterIds)}::jsonb, ${JSON.stringify(tagIds)}::jsonb, ${JSON.stringify(files)}::jsonb, ${Number(user.id)})
      RETURNING *
    `;
    return json({ item: mapItem(rows[0]) }, 201);
  } catch (error) {
    console.error("training_resources_post_failed", error);
    return json({ error: "training_resources_post_failed" }, 500);
  }
}

export async function PATCH(request) {
  try {
    const user = await currentUser(request);
    if (!user) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    const title = String(body.title || "").trim().slice(0, 300);
    const category = String(body.category || "").trim().slice(0, 120);
    const rawLink = String(body.link || "").trim().slice(0, 2048);
    if (!id) return json({ error: "id_required" }, 400);
    if (!title) return json({ error: "title_required" }, 400);
    if (!rawLink) return json({ error: "link_required" }, 400);
    const link = /^https?:\/\//i.test(rawLink) ? rawLink : `https://${rawLink}`;
    try { new URL(link); } catch { return json({ error: "invalid_link" }, 400); }
    const relatedLetterIds = (Array.isArray(body.relatedLetterIds) ? body.relatedLetterIds : []).map(String).filter(Boolean).slice(0, 100);
    const tagIds = [...new Set((Array.isArray(body.tagIds) ? body.tagIds : []).map(String).filter(Boolean))].slice(0, 100);
    const files = (Array.isArray(body.files) ? body.files : []).filter((file) => file && typeof file === "object" && file.url).slice(0, 30).map((file) => ({ name: String(file.name || "file").slice(0, 255), url: String(file.url).slice(0, 1000), size: Number(file.size || 0), type: String(file.type || "").slice(0, 120) }));
    await ensureSchema();
    const rows = await prisma.$queryRaw`
      UPDATE "training_resources"
      SET "title" = ${title}, "category" = ${category}, "link" = ${link},
          "related_letter_ids" = ${JSON.stringify(relatedLetterIds)}::jsonb,
          "tag_ids" = ${JSON.stringify(tagIds)}::jsonb,
          "files" = ${JSON.stringify(files)}::jsonb
      WHERE "id" = ${id}
      RETURNING *
    `;
    if (!rows.length) return json({ error: "not_found" }, 404);
    return json({ item: mapItem(rows[0]) });
  } catch (error) {
    console.error("training_resources_patch_failed", error);
    return json({ error: "training_resources_patch_failed" }, 500);
  }
}

export async function DELETE(request) {
  try {
    if (!await currentUser(request)) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map((id) => String(id).trim()).filter(Boolean))].slice(0, 100);
    if (!ids.length) return json({ error: "ids_required" }, 400);
    await ensureSchema();
    const results = await prisma.$transaction(ids.map((id) => prisma.$executeRaw`DELETE FROM "training_resources" WHERE "id" = ${id}`));
    return json({ ok: true, deleted: results.reduce((sum, count) => sum + Number(count || 0), 0) });
  } catch (error) {
    console.error("training_resources_delete_failed", error);
    return json({ error: "training_resources_delete_failed" }, 500);
  }
}
