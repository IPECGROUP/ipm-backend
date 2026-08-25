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
import { formatMinorUnits, parseRequestedAmount } from "../../../../lib/paymentAmount";

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

    const usageRows = await prisma.paymentRequest.findMany({
      where: {
        ...usageWhere,
        OR: [
          { docId: null },
          { docId: { notIn: ["supply_request", "tenkhah_request"] } },
        ],
      },
      select: { budgetCode: true, amount: true, historyJson: true },
    });

    const used = {};
    for (const r of usageRows || []) {
      const code = String(r?.budgetCode || "").trim();
      if (!code) continue;
      const createdMeta = Array.isArray(r.historyJson)
        ? r.historyJson.find((entry) => entry?.type === "created")
        : null;
      const rialAmountMinorUnits = parseRequestedAmount(createdMeta?.rialAmount ?? r.amount ?? 0, true)?.minorUnits ?? 0n;
      const previousMinorUnits = parseRequestedAmount(used[code] || 0, true)?.minorUnits ?? 0n;
      used[code] = formatMinorUnits(previousMinorUnits + rialAmountMinorUnits);
    }

    const remaining = {};
    for (const [code, total] of Object.entries(totals)) {
      const totalMinorUnits = parseRequestedAmount(total || 0, true)?.minorUnits ?? 0n;
      const usedMinorUnits = parseRequestedAmount(used[code] || 0, true)?.minorUnits ?? 0n;
      remaining[code] = formatMinorUnits(totalMinorUnits > usedMinorUnits ? totalMinorUnits - usedMinorUnits : 0n);
    }

    return json({ totals, used, remaining });
  } catch (e) {
    return json(
      { error: "internal_error", message: String(e?.message || "internal_error") },
      500,
    );
  }
}
