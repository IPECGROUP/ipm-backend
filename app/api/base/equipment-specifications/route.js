import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { ensureEquipmentSpecificationsTable } from "../../../../lib/equipmentSpecificationsSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (data, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const idOf = (value) => { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : null; };
const codeOf = (value) => String(value || "")
  .replace(/[۰-۹]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹".indexOf(digit))
  .replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit))
  .trim().replace(/\s*-\s*/g, "-");
const nameOf = (value) => String(value || "").trim();
const validCode = (code) => code.length <= 120 && /^\d+(?:-\d+)*$/.test(code);

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

async function categoryExists(tx, categoryId) {
  const rows = await tx.$queryRaw`SELECT id FROM equipment_field_categories WHERE id = ${categoryId}`;
  return rows.length > 0;
}

async function parentIdFor(tx, categoryId, code) {
  const index = code.lastIndexOf("-");
  if (index < 0) return null;
  const parentCode = code.slice(0, index);
  const rows = await tx.$queryRaw`SELECT id FROM equipment_specifications WHERE category_id = ${categoryId} AND code = ${parentCode}`;
  if (!rows.length) throw Object.assign(new Error("parent_not_found"), { code: "parent_not_found" });
  return rows[0].id;
}

async function allItems() {
  return prisma.$queryRaw`SELECT s.id, s.category_id AS "categoryId", c.name AS category,
    s.parent_id AS "parentId", s.code, s.name, s.english_name AS "englishName"
    FROM equipment_specifications s JOIN equipment_field_categories c ON c.id = s.category_id
    ORDER BY s.id`;
}

async function specificationInUse(db, id) {
  const [table] = await db.$queryRaw`SELECT to_regclass('equipment_identities') IS NOT NULL AS "exists"`;
  if (!table.exists) return false;
  const key = `spec:${id}`;
  const rows = await db.$queryRaw`SELECT id FROM equipment_identities WHERE field_values ? ${key} LIMIT 1`;
  return rows.length > 0;
}

export async function GET(request) {
  try {
    if (!await currentUser(request)) return json({ error: "unauthorized" }, 401);
    await ensureEquipmentSpecificationsTable();
    return json({ items: await allItems() });
  } catch (error) {
    console.error("equipment_specifications_get_failed", error);
    return json({ error: "internal_error" }, 500);
  }
}

export async function POST(request) {
  try {
    if (!await currentUser(request)) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const categoryId = idOf(body.categoryId);
    const code = codeOf(body.code);
    const name = nameOf(body.name);
    const englishName = nameOf(body.englishName);
    if (!categoryId || !validCode(code) || !name || name.length > 120 || englishName.length > 120) return json({ error: "invalid_input" }, 400);
    await ensureEquipmentSpecificationsTable();
    const item = await prisma.$transaction(async (tx) => {
      if (!await categoryExists(tx, categoryId)) throw Object.assign(new Error("category_not_found"), { code: "category_not_found" });
      const parentId = await parentIdFor(tx, categoryId, code);
      const rows = await tx.$queryRaw`INSERT INTO equipment_specifications (category_id, parent_id, code, name, english_name)
        VALUES (${categoryId}, ${parentId}, ${code}, ${name}, ${englishName}) RETURNING id`;
      return rows[0];
    });
    return json({ item }, 201);
  } catch (error) {
    if (error?.code === "parent_not_found") return json({ error: "parent_not_found" }, 400);
    if (error?.code === "category_not_found") return json({ error: "category_not_found" }, 404);
    if (error?.code === "23505" || error?.meta?.code === "23505") return json({ error: "duplicate_code" }, 409);
    console.error("equipment_specifications_post_failed", error);
    return json({ error: "internal_error" }, 500);
  }
}

export async function PATCH(request) {
  try {
    if (!await currentUser(request)) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const id = idOf(body.id);
    const categoryId = idOf(body.categoryId);
    const code = codeOf(body.code);
    const name = nameOf(body.name);
    const englishName = nameOf(body.englishName);
    if (!id || !categoryId || !validCode(code) || !name || name.length > 120 || englishName.length > 120) return json({ error: "invalid_input" }, 400);
    await ensureEquipmentSpecificationsTable();
    const item = await prisma.$transaction(async (tx) => {
      const [existing] = await tx.$queryRaw`SELECT id, category_id AS "categoryId", code FROM equipment_specifications WHERE id = ${id}`;
      if (!existing) return null;
      if (!await categoryExists(tx, categoryId)) throw Object.assign(new Error("category_not_found"), { code: "category_not_found" });
      if (existing.categoryId !== categoryId && await specificationInUse(tx, id)) throw Object.assign(new Error("specification_in_use"), { code: "specification_in_use" });
      if (existing.code !== code || existing.categoryId !== categoryId) {
        const children = await tx.$queryRaw`SELECT id FROM equipment_specifications WHERE parent_id = ${id} LIMIT 1`;
        if (children.length) throw Object.assign(new Error("has_children"), { code: "has_children" });
      }
      const parentId = await parentIdFor(tx, categoryId, code);
      const rows = await tx.$queryRaw`UPDATE equipment_specifications SET category_id = ${categoryId}, parent_id = ${parentId},
        code = ${code}, name = ${name}, english_name = ${englishName} WHERE id = ${id} RETURNING id`;
      return rows[0];
    });
    return item ? json({ item }) : json({ error: "not_found" }, 404);
  } catch (error) {
    if (error?.code === "parent_not_found") return json({ error: "parent_not_found" }, 400);
    if (error?.code === "category_not_found") return json({ error: "category_not_found" }, 404);
    if (error?.code === "has_children") return json({ error: "has_children" }, 409);
    if (error?.code === "specification_in_use") return json({ error: "specification_in_use" }, 409);
    if (error?.code === "23505" || error?.meta?.code === "23505") return json({ error: "duplicate_code" }, 409);
    console.error("equipment_specifications_patch_failed", error);
    return json({ error: "internal_error" }, 500);
  }
}

export async function DELETE(request) {
  try {
    if (!await currentUser(request)) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const id = idOf(body.id);
    if (!id) return json({ error: "invalid_input" }, 400);
    await ensureEquipmentSpecificationsTable();
    if (await specificationInUse(prisma, id)) return json({ error: "specification_in_use" }, 409);
    const count = await prisma.$executeRaw`DELETE FROM equipment_specifications WHERE id = ${id}`;
    return count ? json({ ok: true }) : json({ error: "not_found" }, 404);
  } catch (error) {
    if (error?.code === "23503" || error?.meta?.code === "23503") return json({ error: "has_children" }, 409);
    console.error("equipment_specifications_delete_failed", error);
    return json({ error: "internal_error" }, 500);
  }
}
