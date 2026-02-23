export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import {
  ensureAllocTable,
  json,
  normalizeAmount,
  parseKindProject,
  toIso,
} from "../_shared";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = parseKindProject(searchParams);
    if (parsed.error) return json({ error: parsed.error }, 400);

    const { kind, projectId } = parsed;

    if (kind === "projects" && !projectId) {
      return json({ history: {} });
    }

    await ensureAllocTable();

    const rows =
      kind === "projects"
        ? await prisma.$queryRawUnsafe(
            `
              SELECT
                code,
                amount::text AS amount,
                description,
                serial,
                date_jalali,
                created_at
              FROM budget_allocations
              WHERE kind = $1 AND project_id = $2
              ORDER BY code ASC, created_at DESC, id DESC
            `,
            kind,
            projectId,
          )
        : await prisma.$queryRawUnsafe(
            `
              SELECT
                code,
                amount::text AS amount,
                description,
                serial,
                date_jalali,
                created_at
              FROM budget_allocations
              WHERE kind = $1 AND project_id IS NULL
              ORDER BY code ASC, created_at DESC, id DESC
            `,
            kind,
          );

    const history = {};
    for (const r of rows || []) {
      const code = String(r?.code || "").trim();
      if (!code) continue;
      if (!history[code]) history[code] = [];
      history[code].push({
        amount: normalizeAmount(r?.amount || 0),
        desc: r?.description == null ? null : String(r.description),
        serial: r?.serial == null ? null : String(r.serial),
        date_jalali: r?.date_jalali == null ? null : String(r.date_jalali),
        created_at: toIso(r?.created_at),
      });
    }

    return json({ history });
  } catch (e) {
    return json(
      { error: "internal_error", message: String(e?.message || "internal_error") },
      500,
    );
  }
}
