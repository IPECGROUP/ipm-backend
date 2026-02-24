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

    // Consumption from payment requests (global for that kind/code, not limited by requester visibility)
    const usageWhere = {
      scope: kind,
      status: { in: ["pending", "approved"] },
    };
    if (kind === "projects") usageWhere.projectId = projectId;

    const usageRows = await prisma.paymentRequest.groupBy({
      by: ["budgetCode"],
      where: usageWhere,
      _sum: { amount: true },
    });

    const used = {};
    for (const r of usageRows || []) {
      const code = String(r?.budgetCode || "").trim();
      if (!code) continue;
      used[code] = normalizeAmount(r?._sum?.amount || 0);
    }

    const remaining = {};
    for (const [code, total] of Object.entries(totals)) {
      const u = Number(used[code] || 0);
      remaining[code] = Math.max(0, Number(total || 0) - u);
    }

    return json({ totals, used, remaining });
  } catch (e) {
    return json(
      { error: "internal_error", message: String(e?.message || "internal_error") },
      500,
    );
  }
}
