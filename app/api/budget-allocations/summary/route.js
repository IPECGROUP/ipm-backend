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
              SELECT code, COALESCE(SUM(${safeAmountExpr}), 0)::text AS total
              FROM budget_allocations
              WHERE kind = $1 ${hasProjectId ? "AND project_id = $2" : ""}
              GROUP BY code
            `,
            kind,
            ...(hasProjectId ? [projectId] : []),
          )
        : await prisma.$queryRawUnsafe(
            `
              SELECT code, COALESCE(SUM(${safeAmountExpr}), 0)::text AS total
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

    return json({ totals });
  } catch (e) {
    return json(
      { error: "internal_error", message: String(e?.message || "internal_error") },
      500,
    );
  }
}
