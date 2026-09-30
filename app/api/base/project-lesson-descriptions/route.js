import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let ready;

async function ensureTable() {
  if (!ready) {
    ready = (async () => {
      await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS project_lesson_categories (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS project_lesson_descriptions (
        id SERIAL PRIMARY KEY,
        category_id INTEGER REFERENCES project_lesson_categories(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      await prisma.$executeRawUnsafe(
        "ALTER TABLE project_lesson_descriptions ADD COLUMN IF NOT EXISTS category_id INTEGER",
      );
      await prisma.$executeRawUnsafe(
        "ALTER TABLE project_lesson_descriptions DROP CONSTRAINT IF EXISTS project_lesson_descriptions_title_key",
      );
      await prisma.$executeRawUnsafe(
        "CREATE UNIQUE INDEX IF NOT EXISTS project_lesson_descriptions_category_title_key ON project_lesson_descriptions (category_id, title)",
      );
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

const titleOf = (value) => String(value || "").trim().slice(0, 120);
const idsOf = (value) => [
  ...new Set(
    (Array.isArray(value) ? value : [])
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0),
  ),
];

export async function GET() {
  try {
    await ensureTable();
    const items = await prisma.$queryRawUnsafe(
      `SELECT descriptions.id, descriptions.title,
              descriptions.category_id AS "categoryId", categories.title AS "categoryTitle"
       FROM project_lesson_descriptions descriptions
       LEFT JOIN project_lesson_categories categories ON categories.id = descriptions.category_id
       ORDER BY descriptions.id ASC`,
    );
    return NextResponse.json(
      { items },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("project_lesson_descriptions_get_error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    await ensureTable();
    const body = await request.json().catch(() => ({}));
    const title = titleOf(body.title);
    const categoryId = Number(body.categoryId);
    if (!title || !Number.isInteger(categoryId) || categoryId <= 0)
      return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    const categories = await prisma.$queryRawUnsafe(
      "SELECT id, title FROM project_lesson_categories WHERE id=$1", categoryId,
    );
    if (!categories[0]) return NextResponse.json({ error: "category_not_found" }, { status: 404 });
    const rows = await prisma.$queryRawUnsafe(
      `INSERT INTO project_lesson_descriptions (category_id, title) VALUES ($1, $2)
       RETURNING id, title, category_id AS "categoryId"`,
      categoryId,
      title,
    );
    return NextResponse.json({ item: { ...rows[0], categoryTitle: categories[0].title } }, { status: 201 });
  } catch (error) {
    if (error?.code === "23505") return NextResponse.json({ error: "title_exists" }, { status: 409 });
    console.error("project_lesson_descriptions_post_error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    await ensureTable();
    const body = await request.json().catch(() => ({}));
    const id = Number(body.id);
    const title = titleOf(body.title);
    const categoryId = Number(body.categoryId);
    if (!Number.isInteger(id) || id <= 0 || !title || !Number.isInteger(categoryId) || categoryId <= 0)
      return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    const categories = await prisma.$queryRawUnsafe(
      "SELECT id, title FROM project_lesson_categories WHERE id=$1", categoryId,
    );
    if (!categories[0]) return NextResponse.json({ error: "category_not_found" }, { status: 404 });
    const rows = await prisma.$queryRawUnsafe(
      `UPDATE project_lesson_descriptions SET category_id=$1, title=$2, updated_at=CURRENT_TIMESTAMP
       WHERE id=$3 RETURNING id, title, category_id AS "categoryId"`,
      categoryId,
      title,
      id,
    );
    return rows[0]
      ? NextResponse.json({ item: { ...rows[0], categoryTitle: categories[0].title } })
      : NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    if (error?.code === "23505") return NextResponse.json({ error: "title_exists" }, { status: 409 });
    console.error("project_lesson_descriptions_patch_error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    await ensureTable();
    const ids = idsOf((await request.json().catch(() => ({}))).ids);
    if (!ids.length) return NextResponse.json({ error: "ids_required" }, { status: 400 });
    await prisma.$executeRawUnsafe(
      "DELETE FROM project_lesson_descriptions WHERE id=ANY($1::int[])",
      ids,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("project_lesson_descriptions_delete_error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
