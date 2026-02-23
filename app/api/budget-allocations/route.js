export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import {
  ALLOWED_KINDS,
  ensureAllocTable,
  json,
  makeNextSerial,
  toIntOrNull,
  toIntOrZero,
} from "./_shared";

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export async function POST(req) {
  try {
    const body = await readJson(req);
    const kind = String(body?.kind || "").trim().toLowerCase();

    if (!ALLOWED_KINDS.has(kind)) {
      return json({ error: "invalid_kind" }, 400);
    }

    const projectId = kind === "projects" ? toIntOrNull(body?.project_id) : null;
    if (kind === "projects" && !projectId) {
      return json({ error: "project_id_required" }, 400);
    }

    const projectName =
      body?.project_name == null ? null : String(body.project_name).trim() || null;

    const rowsIn = Array.isArray(body?.rows) ? body.rows : [];
    const rows = rowsIn
      .map((r) => ({
        code: String(r?.code || "").trim(),
        amount: toIntOrZero(r?.alloc ?? r?.amount),
        description:
          r?.desc == null && r?.description == null
            ? null
            : String(r?.desc ?? r?.description ?? "").trim() || null,
      }))
      .filter((r) => r.code && r.amount !== 0);

    if (!rows.length) {
      return json({ ok: true, inserted: 0 });
    }

    await ensureAllocTable();

    let serial = String(body?.serial || "").trim();
    const dateJalaliRaw =
      body?.date_jalali ?? body?.dateJalali ?? body?.date_fa ?? body?.dateFa ?? null;
    let dateJalali =
      dateJalaliRaw == null ? null : String(dateJalaliRaw).trim() || null;

    if (!serial) {
      const next = await makeNextSerial();
      serial = next.serial;
      if (!dateJalali) dateJalali = next.date_jalali;
    }

    await prisma.$transaction(
      rows.map((r) =>
        prisma.$executeRawUnsafe(
          `
            INSERT INTO budget_allocations
              (serial, date_jalali, kind, project_id, project_name, code, amount, description, created_at)
            VALUES
              ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          `,
          serial,
          dateJalali,
          kind,
          projectId,
          projectName,
          r.code,
          String(r.amount),
          r.description,
        ),
      ),
    );

    return json({ ok: true, serial, inserted: rows.length });
  } catch (e) {
    return json(
      { error: "internal_error", message: String(e?.message || "internal_error") },
      500,
    );
  }
}
