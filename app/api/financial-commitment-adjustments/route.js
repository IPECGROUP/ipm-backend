import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";

export const runtime = "nodejs";

const json = (data, status = 200) => NextResponse.json(data, {
  status,
  headers: { "Cache-Control": "no-store" },
});

function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function amount(value, { signed = false } = {}) {
  const normalized = String(value ?? "")
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[,\s]/g, "");
  if (!(signed ? /^-?\d+$/ : /^\d+$/).test(normalized)) return null;
  try { return BigInt(normalized); } catch { return null; }
}

async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS financial_commitment_adjustments (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      budget_code VARCHAR(80) NOT NULL,
      usage_adjustment BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, budget_code)
    )
  `);
}

export async function GET(request) {
  try {
    const projectId = positiveInt(new URL(request.url).searchParams.get("projectId"));
    if (!projectId) return json({ error: "project_id_required" }, 400);
    await ensureTable();
    const rows = await prisma.$queryRaw`
      SELECT budget_code AS "budgetCode", usage_adjustment::text AS "usageAdjustment"
      FROM financial_commitment_adjustments
      WHERE project_id = ${projectId}
    `;
    return json({ items: rows || [] });
  } catch (error) {
    console.error("financial_commitment_adjustments_get_error", error);
    return json({ error: "internal_error" }, 500);
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const projectId = positiveInt(body.projectId);
    const budgetCode = String(body.budgetCode ?? "").trim();
    const usageAdjustment = amount(body.usageAdjustment, { signed: true });
    if (!projectId || !budgetCode || budgetCode.length > 80 || usageAdjustment === null) {
      return json({ error: "invalid_input" }, 400);
    }
    await ensureTable();
    await prisma.$executeRaw`
      INSERT INTO financial_commitment_adjustments (project_id, budget_code, usage_adjustment, updated_at)
      VALUES (${projectId}, ${budgetCode}, ${usageAdjustment}, CURRENT_TIMESTAMP)
      ON CONFLICT (project_id, budget_code)
      DO UPDATE SET usage_adjustment = EXCLUDED.usage_adjustment, updated_at = CURRENT_TIMESTAMP
    `;
    return json({ ok: true });
  } catch (error) {
    console.error("financial_commitment_adjustments_post_error", error);
    return json({ error: "internal_error" }, 500);
  }
}
