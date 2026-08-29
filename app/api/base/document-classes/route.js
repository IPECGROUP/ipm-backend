import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

let ready;
async function ensureTable() {
  if (!ready) {
    ready = prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS document_classes (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
  return ready;
}

export async function GET() {
  try {
    await ensureTable();
    const items = await prisma.$queryRawUnsafe(
      "SELECT id, title FROM document_classes ORDER BY id ASC"
    );
    return NextResponse.json({ items });
  } catch (error) {
    console.error("document_classes_get_error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    await ensureTable();
    const { title: rawTitle } = await request.json();
    const title = String(rawTitle || "").trim();
    if (!title) return NextResponse.json({ error: "title_required" }, { status: 400 });

    const rows = await prisma.$queryRawUnsafe(
      "INSERT INTO document_classes (title) VALUES ($1) RETURNING id, title",
      title
    );
    return NextResponse.json({ item: rows[0] }, { status: 201 });
  } catch (error) {
    if (error?.code === "23505") return NextResponse.json({ error: "title_exists" }, { status: 409 });
    console.error("document_classes_post_error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
