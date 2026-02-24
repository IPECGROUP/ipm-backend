export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import {
  amountAsSafeBigIntExpr,
  getAllocColumnSet,
  json,
  normalizeAmount,
  parseKindProject,
} from "../_shared";

async function readLegacyBudgetEstimateTotals({ kind, projectId }) {
  try {
    const rows =
      kind === "projects"
        ? await prisma.$queryRawUnsafe(
            `
              WITH ranked AS (
                SELECT
                  code,
                  amount,
                  created_at,
                  ROW_NUMBER() OVER (
                    PARTITION BY code
                    ORDER BY created_at DESC
                  ) AS rn
                FROM budget_estimates
                WHERE kind = $1 AND project_id = $2
              )
              SELECT
                code::text AS code,
                COALESCE(amount, 0)::text AS total
              FROM ranked
              WHERE rn = 1
            `,
            kind,
            projectId,
          )
        : await prisma.$queryRawUnsafe(
            `
              WITH ranked AS (
                SELECT
                  code,
                  amount,
                  created_at,
                  ROW_NUMBER() OVER (
                    PARTITION BY code
                    ORDER BY created_at DESC
                  ) AS rn
                FROM budget_estimates
                WHERE kind = $1 AND project_id IS NULL
              )
              SELECT
                code::text AS code,
                COALESCE(amount, 0)::text AS total
              FROM ranked
              WHERE rn = 1
            `,
            kind,
          );

    const out = {};
    for (const r of rows || []) {
      const code = String(r?.code || "").trim();
      if (!code) continue;
      out[code] = normalizeAmount(r?.total || 0);
    }
    return out;
  } catch {
    // legacy table may be unavailable on some environments
    return {};
  }
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = parseKindProject(searchParams);
    if (parsed.error) return json({ error: parsed.error }, 400);

    const { kind, projectId } = parsed;

    if (kind === "projects" && !projectId) {
      return json({ totals: {} });
    }

    const cols = await getAllocColumnSet();
    const hasProjectId = cols.has("project_id");
    const safeAmountExpr = amountAsSafeBigIntExpr(cols);

    const rows =
      kind === "projects"
        ? await prisma.$queryRawUnsafe(
            `
              SELECT code::text AS code, COALESCE(SUM(${safeAmountExpr}), 0)::text AS total
              FROM budget_allocations
              WHERE kind = $1 ${hasProjectId ? "AND project_id = $2" : ""}
              GROUP BY code
            `,
            kind,
            ...(hasProjectId ? [projectId] : []),
          )
        : await prisma.$queryRawUnsafe(
            `
              SELECT code::text AS code, COALESCE(SUM(${safeAmountExpr}), 0)::text AS total
              FROM budget_allocations
              WHERE kind = $1 ${hasProjectId ? "AND project_id IS NULL" : ""}
              GROUP BY code
            `,
            kind,
          );

    const totals = {};
    for (const r of rows || []) {
      const code = String(r?.code || "").trim();
      if (!code) continue;
      totals[code] = normalizeAmount(r?.total || 0);
    }

    // Backward compatibility: if allocations were historically stored in
    // budget_estimates, expose their latest amount as summary too.
    const legacyTotals = await readLegacyBudgetEstimateTotals({ kind, projectId });
    for (const [code, amount] of Object.entries(legacyTotals)) {
      if (!(code in totals)) totals[code] = amount;
    }

    return json({ totals });
  } catch (e) {
    return json(
      { error: "internal_error", message: String(e?.message || "internal_error") },
      500,
    );
  }
}
