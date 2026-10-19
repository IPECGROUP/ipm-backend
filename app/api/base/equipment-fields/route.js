import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let ready;
const json = (data, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const validKinds = new Set(["category", "title", "field"]);
const idOf = (value) => { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; };
const nameOf = (value) => String(value || "").trim().slice(0, 120);

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

async function ensureTables() {
  if (!ready) ready = (async () => {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS equipment_field_categories (
      id SERIAL PRIMARY KEY, name VARCHAR(120) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS equipment_field_titles (
      id SERIAL PRIMARY KEY, category_id INTEGER REFERENCES equipment_field_categories(id) ON DELETE SET NULL,
      name VARCHAR(120) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(category_id, name)
    )`);
    await prisma.$executeRawUnsafe(`ALTER TABLE equipment_field_titles ALTER COLUMN category_id DROP NOT NULL`);
    await prisma.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_field_titles_category_id_fkey' AND confdeltype = 'n') THEN
        ALTER TABLE equipment_field_titles DROP CONSTRAINT IF EXISTS equipment_field_titles_category_id_fkey;
        ALTER TABLE equipment_field_titles ADD CONSTRAINT equipment_field_titles_category_id_fkey
          FOREIGN KEY (category_id) REFERENCES equipment_field_categories(id) ON DELETE SET NULL;
      END IF;
    END $$`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS equipment_field_definitions (
      id SERIAL PRIMARY KEY, title_id INTEGER NOT NULL REFERENCES equipment_field_titles(id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL, field_type VARCHAR(20) NOT NULL DEFAULT 'text',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(title_id, name)
    )`);
    await prisma.$executeRawUnsafe(`UPDATE equipment_field_definitions SET field_type = 'text' WHERE field_type <> 'text'`);
  })().catch((error) => { ready = null; throw error; });
  return ready;
}

async function allItems() {
  const [categories, titles, fields] = await Promise.all([
    prisma.$queryRaw`SELECT id, name FROM equipment_field_categories ORDER BY id`,
    prisma.$queryRaw`SELECT id, name FROM equipment_field_titles ORDER BY id`,
    prisma.$queryRaw`SELECT id, title_id AS "titleId", name FROM equipment_field_definitions ORDER BY id`,
  ]);
  return { categories, titles, fields };
}

export async function GET(request) {
  try {
    if (!await currentUser(request)) return json({ error: "unauthorized" }, 401);
    await ensureTables();
    return json(await allItems());
  } catch (error) {
    console.error("equipment_fields_get_failed", error);
    return json({ error: "internal_error" }, 500);
  }
}

export async function POST(request) {
  try {
    if (!await currentUser(request)) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const kind = String(body.kind || "");
    const name = nameOf(body.name);
    if (!validKinds.has(kind) || !name) return json({ error: "invalid_input" }, 400);
    await ensureTables();
    let rows;
    if (kind === "category") rows = await prisma.$queryRaw`INSERT INTO equipment_field_categories (name) VALUES (${name}) RETURNING id, name`;
    if (kind === "title") {
      rows = await prisma.$queryRaw`INSERT INTO equipment_field_titles (name) VALUES (${name}) RETURNING id, name`;
    }
    if (kind === "field") {
      const titleId = idOf(body.titleId);
      if (!titleId) return json({ error: "invalid_input" }, 400);
      rows = await prisma.$queryRaw`INSERT INTO equipment_field_definitions (title_id, name, field_type) VALUES (${titleId}, ${name}, 'text') RETURNING id, title_id AS "titleId", name`;
    }
    return json({ item: rows[0] }, 201);
  } catch (error) {
    if (error?.meta?.code === "23505" || error?.code === "23505") return json({ error: "duplicate_name" }, 409);
    if (error?.meta?.code === "23503" || error?.code === "23503") return json({ error: "parent_not_found" }, 404);
    console.error("equipment_fields_post_failed", error);
    return json({ error: "internal_error" }, 500);
  }
}

export async function PATCH(request) {
  try {
    if (!await currentUser(request)) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const kind = String(body.kind || "");
    const id = idOf(body.id);
    const name = nameOf(body.name);
    if (!validKinds.has(kind) || !id || !name) return json({ error: "invalid_input" }, 400);
    await ensureTables();
    let rows;
    if (kind === "category") rows = await prisma.$queryRaw`UPDATE equipment_field_categories SET name = ${name} WHERE id = ${id} RETURNING id, name`;
    if (kind === "title") {
      rows = await prisma.$queryRaw`UPDATE equipment_field_titles SET name = ${name} WHERE id = ${id} RETURNING id, name`;
    }
    if (kind === "field") {
      const titleId = idOf(body.titleId);
      if (!titleId) return json({ error: "invalid_input" }, 400);
      rows = await prisma.$queryRaw`UPDATE equipment_field_definitions SET name = ${name}, title_id = ${titleId}, field_type = 'text' WHERE id = ${id} RETURNING id, title_id AS "titleId", name`;
    }
    return rows[0] ? json({ item: rows[0] }) : json({ error: "not_found" }, 404);
  } catch (error) {
    if (error?.meta?.code === "23505" || error?.code === "23505") return json({ error: "duplicate_name" }, 409);
    if (error?.meta?.code === "23503" || error?.code === "23503") return json({ error: "parent_not_found" }, 404);
    console.error("equipment_fields_patch_failed", error);
    return json({ error: "internal_error" }, 500);
  }
}

export async function DELETE(request) {
  try {
    if (!await currentUser(request)) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const kind = String(body.kind || "");
    const id = idOf(body.id);
    if (!validKinds.has(kind) || !id) return json({ error: "invalid_input" }, 400);
    await ensureTables();
    let count;
    if (kind === "category") count = await prisma.$executeRaw`DELETE FROM equipment_field_categories WHERE id = ${id}`;
    if (kind === "title") count = await prisma.$executeRaw`DELETE FROM equipment_field_titles WHERE id = ${id}`;
    if (kind === "field") count = await prisma.$executeRaw`DELETE FROM equipment_field_definitions WHERE id = ${id}`;
    return count ? json({ ok: true }) : json({ error: "not_found" }, 404);
  } catch (error) {
    console.error("equipment_fields_delete_failed", error);
    return json({ error: "internal_error" }, 500);
  }
}
