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
  if (!schemaPromise) schemaPromise = (async () => {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS base_libraries (id SERIAL PRIMARY KEY, title TEXT NOT NULL UNIQUE, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS library_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        library_id INTEGER NOT NULL,
        related_letter_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        tag_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        files JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_by_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await prisma.$executeRawUnsafe(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS tag_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
  })().catch((error) => { schemaPromise = null; throw error; });
  return schemaPromise;
}

function cleanFiles(value) {
  return (Array.isArray(value) ? value : []).filter((file) => file && typeof file === "object" && file.url).slice(0, 30).map((file) => ({ name: String(file.name || "file").slice(0, 255), url: String(file.url).slice(0, 1000), size: Number(file.size || 0), type: String(file.type || "").slice(0, 120) }));
}

function mapItem(row) {
  return { id: row.id, title: row.title, libraryId: row.library_id, libraryTitle: row.library_title || "", relatedLetterIds: Array.isArray(row.related_letter_ids) ? row.related_letter_ids : [], tagIds: Array.isArray(row.tag_ids) ? row.tag_ids.map(String) : [], files: Array.isArray(row.files) ? row.files : [], createdById: row.created_by_id, createdAt: row.created_at };
}

async function findLibrary(id) {
  const rows = await prisma.$queryRawUnsafe("SELECT id, title FROM base_libraries WHERE id=$1", id);
  return rows[0] || null;
}

export async function GET(request) {
  try {
    if (!await currentUser(request)) return json({ error: "unauthorized" }, 401);
    await ensureSchema();
    const rows = await prisma.$queryRawUnsafe(`SELECT i.*, l.title AS library_title FROM library_items i LEFT JOIN base_libraries l ON l.id=i.library_id ORDER BY i.created_at DESC`);
    return json({ items: rows.map(mapItem) });
  } catch (error) {
    console.error("library_items_get_failed", error);
    return json({ error: "library_items_get_failed" }, 500);
  }
}

export async function POST(request) {
  try {
    const user = await currentUser(request);
    if (!user) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const title = String(body.title || "").trim().slice(0, 300);
    const libraryId = Number(body.libraryId);
    if (!title) return json({ error: "title_required" }, 400);
    if (!Number.isInteger(libraryId) || libraryId <= 0) return json({ error: "library_required" }, 400);
    await ensureSchema();
    const library = await findLibrary(libraryId);
    if (!library) return json({ error: "library_not_found" }, 400);
    const id = randomUUID();
    const relatedLetterIds = (Array.isArray(body.relatedLetterIds) ? body.relatedLetterIds : []).map(String).filter(Boolean).slice(0, 100);
    const tagIds = [...new Set((Array.isArray(body.tagIds) ? body.tagIds : []).map(String).filter(Boolean))].slice(0, 100);
    const files = cleanFiles(body.files);
    const rows = await prisma.$queryRaw`
      INSERT INTO library_items (id,title,library_id,related_letter_ids,tag_ids,files,created_by_id)
      VALUES (${id},${title},${libraryId},${JSON.stringify(relatedLetterIds)}::jsonb,${JSON.stringify(tagIds)}::jsonb,${JSON.stringify(files)}::jsonb,${Number(user.id)}) RETURNING *
    `;
    return json({ item: mapItem({ ...rows[0], library_title: library.title }) }, 201);
  } catch (error) {
    console.error("library_items_post_failed", error);
    return json({ error: "library_items_post_failed" }, 500);
  }
}

export async function PATCH(request) {
  try {
    if (!await currentUser(request)) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    const title = String(body.title || "").trim().slice(0, 300);
    const libraryId = Number(body.libraryId);
    if (!id) return json({ error: "id_required" }, 400);
    if (!title) return json({ error: "title_required" }, 400);
    if (!Number.isInteger(libraryId) || libraryId <= 0) return json({ error: "library_required" }, 400);
    await ensureSchema();
    const library = await findLibrary(libraryId);
    if (!library) return json({ error: "library_not_found" }, 400);
    const relatedLetterIds = (Array.isArray(body.relatedLetterIds) ? body.relatedLetterIds : []).map(String).filter(Boolean).slice(0, 100);
    const tagIds = [...new Set((Array.isArray(body.tagIds) ? body.tagIds : []).map(String).filter(Boolean))].slice(0, 100);
    const files = cleanFiles(body.files);
    const rows = await prisma.$queryRaw`
      UPDATE library_items SET title=${title},library_id=${libraryId},related_letter_ids=${JSON.stringify(relatedLetterIds)}::jsonb,tag_ids=${JSON.stringify(tagIds)}::jsonb,files=${JSON.stringify(files)}::jsonb
      WHERE id=${id} RETURNING *
    `;
    if (!rows.length) return json({ error: "not_found" }, 404);
    return json({ item: mapItem({ ...rows[0], library_title: library.title }) });
  } catch (error) {
    console.error("library_items_patch_failed", error);
    return json({ error: "library_items_patch_failed" }, 500);
  }
}

export async function DELETE(request) {
  try {
    if (!await currentUser(request)) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String).map((id) => id.trim()).filter(Boolean))].slice(0, 100);
    if (!ids.length) return json({ error: "ids_required" }, 400);
    await ensureSchema();
    const results = await prisma.$transaction(ids.map((id) => prisma.$executeRaw`DELETE FROM library_items WHERE id=${id}`));
    return json({ ok: true, deleted: results.reduce((sum, value) => sum + Number(value || 0), 0) });
  } catch (error) {
    console.error("library_items_delete_failed", error);
    return json({ error: "library_items_delete_failed" }, 500);
  }
}
