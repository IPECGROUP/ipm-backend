import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasPagePermission } from "@/lib/pagePermissions";

export async function POST(request) {
  if (!await hasPagePermission(request, "ساختار شکست هزینه‌ها", "نمایش منو")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const projectId = Number(body?.projectId);
  const rows = body?.rows;
  if (!Number.isSafeInteger(projectId) || projectId <= 0 || !Array.isArray(rows) || !rows.length || rows.length > 1000) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const clean = rows.map((row) => ({ budget_code: String(row?.budgetCode || "").trim(), budget_name: String(row?.budgetName || "").trim(), base_budget: String(row?.baseBudget ?? "0") }));
  if (clean.some((row) => !/^\d+(?:-\d+)+$/.test(row.budget_code) || row.budget_code.length > 80 || !row.budget_name || row.budget_name.length > 255 || !/^\d{1,18}$/.test(row.base_budget)) || new Set(clean.map((row) => row.budget_code)).size !== clean.length) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  try {
    const project = await prisma.$queryRaw`SELECT code FROM projects WHERE id = ${projectId} AND is_active = true`;
    if (!project.length) return NextResponse.json({ error: "active_project_not_found" }, { status: 404 });
    if (clean.some((row) => !row.budget_code.startsWith(`${project[0].code}-`))) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    const json = JSON.stringify(clean);
    await prisma.$executeRaw`INSERT INTO cost_breakdown_items (project_id, budget_code, budget_name, base_budget, updated_at)
      SELECT ${projectId}, item.budget_code, item.budget_name, item.base_budget::bigint, CURRENT_TIMESTAMP
      FROM jsonb_to_recordset(${json}::jsonb) AS item(budget_code text, budget_name text, base_budget text)`;
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("cost_breakdown_batch_failed", error);
    if (error?.code === "P2002" || /duplicate key|unique constraint/i.test(String(error?.message || ""))) return NextResponse.json({ error: "duplicate_budget_code" }, { status: 409 });
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
