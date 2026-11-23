import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requirePagePermission } from "../../../lib/pagePermissions";

export const runtime = "nodejs";
const json = (data, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const positiveInt = (value) => { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : null; };

async function ensureTable() {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS financial_commitment_monthly_adjustments (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    budget_code VARCHAR(80) NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, budget_code, year, month)
  )`);
}

export async function GET(req) {
  const denied = await requirePagePermission(req, "تعهدات و مصارف مالی", "نمایش منو");
  if (denied) return denied;
  try {
    const projectId = positiveInt(new URL(req.url).searchParams.get("projectId"));
    if (!projectId) return json({ error: "invalid_project" }, 400);
    await ensureTable();
    const items = await prisma.$queryRaw`SELECT budget_code AS "budgetCode", year, month, amount_minor::text AS "amountMinor" FROM financial_commitment_monthly_adjustments WHERE project_id = ${projectId}`;
    return json({ items });
  } catch (error) {
    console.error("monthly_adjustments_get_error", error);
    return json({ error: "internal_error" }, 500);
  }
}

export async function POST(req) {
  const denied = await requirePagePermission(req, "تعهدات و مصارف مالی", "افزودن");
  if (denied) return denied;
  try {
    const body = await req.json();
    const projectId = positiveInt(body.projectId);
    const code = String(body.budgetCode ?? "").trim();
    const year = positiveInt(body.year), month = positiveInt(body.month);
    const increment = String(body.incrementMinor ?? "");
    const expected = String(body.expectedAdjustmentMinor ?? "");
    if (!projectId || !/^\d+(?:-\d+)*$/.test(code) || code.length > 80 || !year || year < 1300 || year > 1500 || !month || month > 12 || !/^\d+$/.test(increment) || !/^\d+$/.test(expected) || BigInt(increment) <= 0n || BigInt(increment) > 9223372036854775807n) return json({ error: "invalid_input" }, 400);
    await ensureTable();
    // Only accept a code belonging to this project, including normalized codes used by the UI.
    const rows = await prisma.$queryRaw`SELECT c.budget_code AS code, p.code AS "projectCode" FROM cost_breakdown_items c JOIN projects p ON p.id = c.project_id WHERE c.project_id = ${projectId}`;
    const normalize = (value) => String(value ?? "").replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).trim().replace(/[^\d.-]/g, "-").replace(/[.-]+/g, "-").replace(/^-|-$/g, "");
    const exists = rows.some((row) => { const project = normalize(row.projectCode), raw = normalize(row.code); return (project && raw !== project && !raw.startsWith(`${project}-`) ? `${project}-${raw}` : raw) === code; });
    if (!exists) return json({ error: "budget_not_found" }, 404);
    const saved = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${projectId}::integer, 6)::text`;
      const [current] = await tx.$queryRaw`SELECT COALESCE(SUM(amount_minor), 0)::text AS amount FROM financial_commitment_monthly_adjustments WHERE project_id = ${projectId} AND year = ${year} AND month = ${month}`;
      if (BigInt(current.amount) !== BigInt(expected)) return false;
      await tx.$executeRaw`INSERT INTO financial_commitment_monthly_adjustments (project_id, budget_code, year, month, amount_minor) VALUES (${projectId}, ${code}, ${year}, ${month}, ${BigInt(increment)}) ON CONFLICT (project_id, budget_code, year, month) DO UPDATE SET amount_minor = financial_commitment_monthly_adjustments.amount_minor + EXCLUDED.amount_minor, updated_at = CURRENT_TIMESTAMP`;
      return true;
    });
    if (!saved) return json({ error: "stale_amount" }, 409);
    return json({ ok: true });
  } catch (error) {
    console.error("monthly_adjustments_post_error", error);
    return json({ error: "internal_error" }, 500);
  }
}
