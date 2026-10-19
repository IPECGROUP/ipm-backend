import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { ensureEquipmentFieldTables } from "../../../../lib/equipmentFieldsSchema";

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
  const [categories, titles, fields] = await Promise.all([
    prisma.$queryRaw`SELECT id, name FROM equipment_field_categories ORDER BY id`,
    prisma.$queryRaw`SELECT id, name FROM equipment_field_titles ORDER BY id`,
    prisma.$queryRaw`SELECT id, category_id AS "categoryId", title_id AS "titleId", name FROM equipment_field_definitions ORDER BY id`,
  ]);
  return { categories, titles, fields };
}

export async function GET(request) {
  try {
    if (!await currentUser(request)) return json({ error: "unauthorized" }, 401);
    await ensureEquipmentFieldTables();
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
