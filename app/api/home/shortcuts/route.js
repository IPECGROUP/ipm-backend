import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getAuthenticatedUser } from "../../../../lib/security";

export const dynamic = "force-dynamic";

async function ensureTable() {
  await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS home_shortcut_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
    paths JSONB NOT NULL DEFAULT '[]'::jsonb
  )`;
}

export async function GET(request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    await ensureTable();
    const rows = await prisma.$queryRaw`SELECT paths FROM home_shortcut_preferences WHERE user_id = ${user.id}`;
    return NextResponse.json({ paths: rows[0]?.paths ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("home_shortcuts_load_failed", error);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
}

export async function PUT(request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.paths) || body.paths.length > 100 || body.paths.some((path) => typeof path !== "string" || !path.startsWith("/") || path.length > 200)) {
    return NextResponse.json({ error: "invalid_paths" }, { status: 400 });
  }
  const paths = [...new Set(body.paths)];
  try {
    await ensureTable();
    const json = JSON.stringify(paths);
    if (body.onlyIfMissing === true) {
      await prisma.$executeRaw`INSERT INTO home_shortcut_preferences (user_id, paths) VALUES (${user.id}, ${json}::jsonb) ON CONFLICT (user_id) DO NOTHING`;
      const rows = await prisma.$queryRaw`SELECT paths FROM home_shortcut_preferences WHERE user_id = ${user.id}`;
      return NextResponse.json({ paths: rows[0].paths });
    }
    await prisma.$executeRaw`INSERT INTO home_shortcut_preferences (user_id, paths) VALUES (${user.id}, ${json}::jsonb) ON CONFLICT (user_id) DO UPDATE SET paths = EXCLUDED.paths`;
    return NextResponse.json({ paths });
  } catch (error) {
    console.error("home_shortcuts_save_failed", error);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
