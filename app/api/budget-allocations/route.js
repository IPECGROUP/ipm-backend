export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { requirePagePermission } from "@/lib/pagePermissions";
import { getAuthenticatedUser, requireAdmin } from "@/lib/security";
import { writeAuditLog } from "@/lib/auditLog";
import {
  ALLOWED_KINDS,
  getAllocColumnSet,
  json,
  makeNextSerial,
  pickAllocAmountColumn,
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
  const denied = await requirePagePermission(req, "تخصیص نقدینگی", "افزودن");
  if (denied) return denied;
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

    const cols = await getAllocColumnSet();

    const has = (name) => cols.has(name);
    const amountColumn = pickAllocAmountColumn(cols);
    const descColumn = has("description") ? "description" : has("desc") ? "desc" : null;

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

    await prisma.$transaction(rows.map((r) => {
      const insertCols = [];
      const placeholders = [];
      const values = [];

      const addVal = (name, value) => {
        insertCols.push(name);
        values.push(value);
        placeholders.push(`$${values.length}`);
      };

      if (has("serial")) addVal("serial", serial);
      if (has("date_jalali")) addVal("date_jalali", dateJalali);
      if (has("kind")) addVal("kind", kind);
      if (has("project_id")) addVal("project_id", projectId);
      if (has("project_name")) addVal("project_name", projectName);
      if (has("code")) addVal("code", r.code);
      if (amountColumn) addVal(amountColumn, String(r.amount));
      if (descColumn) addVal(descColumn === "desc" ? `"desc"` : "description", r.description);

      if (!insertCols.length) {
        throw new Error("budget_allocations_has_no_supported_columns");
      }

      const colsSql = insertCols.join(", ");
      const valsSql = placeholders.join(", ");
      const sql = `INSERT INTO budget_allocations (${colsSql}) VALUES (${valsSql})`;
      return prisma.$executeRawUnsafe(sql, ...values);
    }));

    const actor = await getAuthenticatedUser(req);
    await writeAuditLog({ request: req, actor, action: "budget_allocation.create", entityType: "budget_allocation", details: { serial, kind, projectId, inserted: rows.length } });
    return json({ ok: true, serial, inserted: rows.length });
  } catch (e) {
    return json(
      { error: "internal_error", message: String(e?.message || "internal_error") },
      500,
    );
  }
}

export async function DELETE(req) {
  const auth = await requireAdmin(req);
  if (auth.denied) return auth.denied;
  try {
    await getAllocColumnSet();
    const deleted = await prisma.$executeRawUnsafe(`DELETE FROM budget_allocations`);
    await writeAuditLog({ request: req, actor: auth.user, action: "budget_allocation.delete_all", entityType: "budget_allocation", severity: "critical", details: { deleted: Number(deleted || 0) } });
    return json({ ok: true, deleted: Number(deleted || 0) });
  } catch (e) {
    return json(
      { error: "internal_error", message: String(e?.message || "internal_error") },
      500,
    );
  }
}
