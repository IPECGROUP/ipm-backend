import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let ready;

async function ensureTable() {
  if (!ready) {
    ready = prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS project_lesson_categories (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `).catch((error) => {
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
      "SELECT id, title FROM project_lesson_categories ORDER BY id ASC",
    );
    return NextResponse.json(
      { items },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("project_lesson_categories_get_error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    await ensureTable();
    const title = titleOf((await request.json().catch(() => ({}))).title);
    if (!title) return NextResponse.json({ error: "title_required" }, { status: 400 });
    const rows = await prisma.$queryRawUnsafe(
      "INSERT INTO project_lesson_categories (title) VALUES ($1) RETURNING id, title",
      title,
    );
    return NextResponse.json({ item: rows[0] }, { status: 201 });
  } catch (error) {
    if (error?.code === "23505") return NextResponse.json({ error: "title_exists" }, { status: 409 });
    console.error("project_lesson_categories_post_error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    await ensureTable();
    const body = await request.json().catch(() => ({}));
    const id = Number(body.id);
    const title = titleOf(body.title);
    if (!Number.isInteger(id) || id <= 0 || !title)
      return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    const rows = await prisma.$queryRawUnsafe(
      "UPDATE project_lesson_categories SET title=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING id, title",
      title,
      id,
    );
    return rows[0]
      ? NextResponse.json({ item: rows[0] })
      : NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    if (error?.code === "23505") return NextResponse.json({ error: "title_exists" }, { status: 409 });
    console.error("project_lesson_categories_patch_error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    await ensureTable();
    const ids = idsOf((await request.json().catch(() => ({}))).ids);
    if (!ids.length) return NextResponse.json({ error: "ids_required" }, { status: 400 });
    await prisma.$executeRawUnsafe(
      "DELETE FROM project_lesson_categories WHERE id=ANY($1::int[])",
      ids,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("project_lesson_categories_delete_error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
