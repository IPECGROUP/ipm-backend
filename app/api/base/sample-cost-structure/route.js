import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/security";
import initial from "./initial.json";

export const dynamic = "force-dynamic";

async function authorize(request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!["ali", "marandi", "nouri"].includes(String(user.username || "").trim().toLowerCase())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return null;
}

async function ensureTemplate() {
  await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS sample_cost_structure (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    rows JSONB NOT NULL
  )`;
  const initialRows = JSON.stringify(initial.rows);
  await prisma.$executeRaw`INSERT INTO sample_cost_structure (id, rows) VALUES (1, ${initialRows}::jsonb) ON CONFLICT (id) DO NOTHING`;
}

export async function GET(request) {
  const denied = await authorize(request);
  if (denied) return denied;
  try {
    await ensureTemplate();
    const result = await prisma.$queryRaw`SELECT rows FROM sample_cost_structure WHERE id = 1`;
    return NextResponse.json({ project: initial.project, rows: result[0].rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("sample_cost_structure_get_failed", error);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
}

export async function POST(request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const code = String(body?.budgetCode || "").trim();
  const name = String(body?.budgetName || "").trim();
  if (!/^159(?:-\d+)+$/.test(code) || code.length > 80 || !name || name.length > 255) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  try {
    await ensureTemplate();
    const item = { budgetCode: code, budgetName: name, baseBudget: 0 };
    const json = JSON.stringify([item]);
    const result = await prisma.$queryRaw`UPDATE sample_cost_structure SET rows = rows || ${json}::jsonb
      WHERE id = 1 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(rows) AS item WHERE item->>'budgetCode' = ${code})
      RETURNING rows`;
    if (!result.length) return NextResponse.json({ error: "duplicate_code" }, { status: 409 });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    console.error("sample_cost_structure_post_failed", error);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
