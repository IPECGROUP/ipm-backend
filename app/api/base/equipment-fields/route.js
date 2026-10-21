import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { ensureEquipmentFieldTables } from "../../../../lib/equipmentFieldsSchema";
import { ensureEquipmentSpecificationsTable } from "../../../../lib/equipmentSpecificationsSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

async function allItems() {
  const [categories, titles, fields, rows, specifications] = await Promise.all([
    prisma.$queryRaw`SELECT id, name FROM equipment_field_categories ORDER BY id`,
    prisma.$queryRaw`SELECT id, name FROM equipment_field_titles ORDER BY id`,
    prisma.$queryRaw`SELECT id, category_id AS "categoryId", title_id AS "titleId", name FROM equipment_field_definitions ORDER BY id`,
    prisma.$queryRaw`SELECT f.id, c.name AS category, t.name AS title, f.name AS field,
      f.category_id AS "categoryId", f.title_id AS "titleId"
      FROM equipment_field_definitions f
      JOIN equipment_field_categories c ON c.id = f.category_id
      JOIN equipment_field_titles t ON t.id = f.title_id
      ORDER BY f.id`,
    prisma.$queryRaw`SELECT id, category_id AS "categoryId", parent_id AS "parentId", code, name, english_name AS "englishName"
      FROM equipment_specifications ORDER BY id`,
  ]);
  return { categories, titles, fields, rows, specifications };
}

async function parentIds(tx, categoryIdInput, categoryName, titleName) {
  const categoryId = idOf(categoryIdInput);
  const [category] = categoryId
    ? await tx.$queryRaw`SELECT id FROM equipment_field_categories WHERE id = ${categoryId}`
    : await tx.$queryRaw`INSERT INTO equipment_field_categories (name) VALUES (${categoryName})
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
  if (!category) throw Object.assign(new Error("parent_not_found"), { code: "parent_not_found" });
  const [title] = await tx.$queryRaw`INSERT INTO equipment_field_titles (category_id, name) VALUES (${category.id}, ${titleName})
    ON CONFLICT (category_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
  return { categoryId: category.id, titleId: title.id };
}

export async function GET(request) {
  try {
    if (!await currentUser(request)) return json({ error: "unauthorized" }, 401);
    await ensureEquipmentSpecificationsTable();
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
    if (kind === "triple") {
      const category = nameOf(body.category);
      const title = nameOf(body.title);
      const field = nameOf(body.field);
      if ((!idOf(body.categoryId) && !category) || !title || !field) return json({ error: "invalid_input" }, 400);
      await ensureEquipmentFieldTables();
      const item = await prisma.$transaction(async (tx) => {
        const { categoryId, titleId } = await parentIds(tx, body.categoryId, category, title);
        const inserted = await tx.$queryRaw`INSERT INTO equipment_field_definitions (category_id, title_id, name, field_type)
          VALUES (${categoryId}, ${titleId}, ${field}, 'text') ON CONFLICT DO NOTHING RETURNING id`;
        if (!inserted.length) throw Object.assign(new Error("duplicate_name"), { code: "duplicate_name" });
        return inserted[0];
      });
      return json({ item }, 201);
    }
    if (!validKinds.has(kind) || !name) return json({ error: "invalid_input" }, 400);
    await ensureEquipmentFieldTables();
    let rows;
    if (kind === "category") rows = await prisma.$queryRaw`INSERT INTO equipment_field_categories (name) VALUES (${name}) RETURNING id, name`;
    if (kind === "title") {
      rows = await prisma.$queryRaw`INSERT INTO equipment_field_titles (name) VALUES (${name}) RETURNING id, name`;
    }
    if (kind === "field") {
      const categoryId = idOf(body.categoryId);
      const titleId = idOf(body.titleId);
      if (!categoryId || !titleId) return json({ error: "invalid_input" }, 400);
      rows = await prisma.$queryRaw`INSERT INTO equipment_field_definitions (category_id, title_id, name, field_type) VALUES (${categoryId}, ${titleId}, ${name}, 'text') RETURNING id, category_id AS "categoryId", title_id AS "titleId", name`;
    }
    return json({ item: rows[0] }, 201);
  } catch (error) {
    if (error?.meta?.code === "23505" || ["23505", "duplicate_name"].includes(error?.code)) return json({ error: "duplicate_name" }, 409);
    if (error?.meta?.code === "23503" || ["23503", "parent_not_found"].includes(error?.code)) return json({ error: "parent_not_found" }, 404);
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
    if (kind === "triple") {
      const category = nameOf(body.category);
      const title = nameOf(body.title);
      const field = nameOf(body.field);
      if (!id || (!idOf(body.categoryId) && !category) || !title || !field) return json({ error: "invalid_input" }, 400);
      await ensureEquipmentFieldTables();
      const item = await prisma.$transaction(async (tx) => {
        const existing = await tx.$queryRaw`SELECT id FROM equipment_field_definitions WHERE id = ${id}`;
        if (!existing.length) return null;
        const { categoryId, titleId } = await parentIds(tx, body.categoryId, category, title);
        const updated = await tx.$queryRaw`UPDATE equipment_field_definitions
          SET category_id = ${categoryId}, title_id = ${titleId}, name = ${field}, field_type = 'text'
          WHERE id = ${id} RETURNING id`;
        return updated[0];
      });
      return item ? json({ item }) : json({ error: "not_found" }, 404);
    }
    if (!validKinds.has(kind) || !id || !name) return json({ error: "invalid_input" }, 400);
    await ensureEquipmentFieldTables();
    let rows;
    if (kind === "category") rows = await prisma.$queryRaw`UPDATE equipment_field_categories SET name = ${name} WHERE id = ${id} RETURNING id, name`;
    if (kind === "title") {
      rows = await prisma.$queryRaw`UPDATE equipment_field_titles SET name = ${name} WHERE id = ${id} RETURNING id, name`;
    }
    if (kind === "field") {
      const categoryId = idOf(body.categoryId);
      const titleId = idOf(body.titleId);
      if (!categoryId || !titleId) return json({ error: "invalid_input" }, 400);
      rows = await prisma.$queryRaw`UPDATE equipment_field_definitions SET name = ${name}, category_id = ${categoryId}, title_id = ${titleId}, field_type = 'text' WHERE id = ${id} RETURNING id, category_id AS "categoryId", title_id AS "titleId", name`;
    }
    return rows[0] ? json({ item: rows[0] }) : json({ error: "not_found" }, 404);
  } catch (error) {
    if (error?.meta?.code === "23505" || error?.code === "23505") return json({ error: "duplicate_name" }, 409);
    if (error?.meta?.code === "23503" || ["23503", "parent_not_found"].includes(error?.code)) return json({ error: "parent_not_found" }, 404);
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
    await ensureEquipmentFieldTables();
    let count;
    if (kind === "category") count = await prisma.$executeRaw`DELETE FROM equipment_field_categories WHERE id = ${id}`;
    if (kind === "title") count = await prisma.$executeRaw`DELETE FROM equipment_field_titles WHERE id = ${id}`;
    if (kind === "field") count = await prisma.$executeRaw`DELETE FROM equipment_field_definitions WHERE id = ${id}`;
    return count ? json({ ok: true }) : json({ error: "not_found" }, 404);
  } catch (error) {
    if (["23503", "23001"].includes(error?.meta?.code || error?.code)) return json({ error: "category_in_use" }, 409);
    console.error("equipment_fields_delete_failed", error);
    return json({ error: "internal_error" }, 500);
  }
}
