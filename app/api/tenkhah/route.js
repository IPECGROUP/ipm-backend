import { prisma } from "../../../lib/prisma";

export const runtime = "nodejs";
const json = (data, status = 200) => Response.json(data, { status });
const cookie = (r, n) => String(r.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${n}=([^;]+)`))?.[1] || "";
async function userIdOf(r) { const raw = r.headers.get("x-user-id") || cookie(r, "user_id"); if (/^\d+$/.test(raw)) return +raw; const sid = cookie(r, "ipm_session"); const s = sid && await prisma.session.findUnique({ where: { id: sid } }).catch(() => null); return s?.userId || (process.env.NODE_ENV !== "production" ? 1 : null); }
const amount = (v) => { const x = String(v ?? "").replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[^\d]/g, ""); return x ? BigInt(x) : 0n; };

let ready;
async function ensure() {
  if (!ready) ready = (async () => {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS tenkhah_requests (id SERIAL PRIMARY KEY, request_number VARCHAR(120) NOT NULL, request_date VARCHAR(20) NOT NULL, project_id INTEGER NOT NULL, requested_amount BIGINT NOT NULL, currency VARCHAR(12) NOT NULL DEFAULT 'IRR', unregistered_balance BIGINT NOT NULL DEFAULT 0, unsettled_balance BIGINT NOT NULL DEFAULT 0, created_by_id INTEGER NOT NULL, project_manager_id INTEGER NOT NULL, finance_user_id INTEGER, current_assignee_user_id INTEGER, stage VARCHAR(20) NOT NULL DEFAULT 'project_manager', status VARCHAR(20) NOT NULL DEFAULT 'pending', manager_approved_date VARCHAR(20), project_liquidity BIGINT, charged_date VARCHAR(20), charged_amount BIGINT, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await prisma.$executeRawUnsafe("ALTER TABLE tenkhah_requests ADD COLUMN IF NOT EXISTS payment_request_id INTEGER");
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS tenkhah_settlements (id SERIAL PRIMARY KEY, tenkhah_request_id INTEGER NOT NULL, created_by_id INTEGER NOT NULL, current_assignee_user_id INTEGER, stage VARCHAR(32) NOT NULL DEFAULT 'control_project', status VARCHAR(24) NOT NULL DEFAULT 'pending', created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS tenkhah_settlement_entries (id SERIAL PRIMARY KEY, settlement_id INTEGER NOT NULL, expense_date VARCHAR(20) NOT NULL, description TEXT NOT NULL DEFAULT '', budget_code VARCHAR(80) NOT NULL, amount BIGINT NOT NULL, file_name VARCHAR(255), file_url TEXT, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS tenkhah_assignee_idx ON tenkhah_requests(current_assignee_user_id)");
    await prisma.$executeRawUnsafe("CREATE UNIQUE INDEX IF NOT EXISTS tenkhah_payment_request_idx ON tenkhah_requests(payment_request_id) WHERE payment_request_id IS NOT NULL");
    await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS tenkhah_settlement_assignee_idx ON tenkhah_settlements(current_assignee_user_id)");
  })();
  return ready;
}
async function requests(where = "", params = []) {
  return prisma.$queryRawUnsafe(`SELECT t.id,t.request_number AS "requestNumber",t.request_date AS "requestDate",t.project_id AS "projectId",t.requested_amount::text AS "requestedAmount",t.currency,
    GREATEST(0,t.requested_amount-COALESCE((SELECT SUM(e.amount) FROM tenkhah_settlements s JOIN tenkhah_settlement_entries e ON e.settlement_id=s.id WHERE s.tenkhah_request_id=t.id),0))::text AS "unregisteredBalance",
    GREATEST(0,t.requested_amount-COALESCE((SELECT SUM(e.amount) FROM tenkhah_settlements s JOIN tenkhah_settlement_entries e ON e.settlement_id=s.id WHERE s.tenkhah_request_id=t.id AND s.status='completed'),0))::text AS "unsettledBalance",
    t.payment_request_id AS "paymentRequestId",t.created_by_id AS "createdById",t.project_manager_id AS "projectManagerId",t.finance_user_id AS "financeUserId",t.current_assignee_user_id AS "currentAssigneeUserId",t.stage,t.status,t.manager_approved_date AS "managerApprovedDate",t.project_liquidity::text AS "projectLiquidity",t.charged_date AS "chargedDate",t.charged_amount::text AS "chargedAmount",p.code AS "projectCode",p.name AS "projectName",creator.name AS "requesterName",creator.username AS "requesterUsername",assignee.name AS "currentAssigneeName" FROM tenkhah_requests t LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN "User" creator ON creator.id=t.created_by_id LEFT JOIN "User" assignee ON assignee.id=t.current_assignee_user_id ${where} ORDER BY t.created_at DESC`, ...params);
}
async function settlements(ids) { if (!ids.length) return []; const data = await prisma.$queryRawUnsafe(`SELECT s.id,s.tenkhah_request_id AS "tenkhahRequestId",s.created_by_id AS "createdById",s.current_assignee_user_id AS "currentAssigneeUserId",s.stage,s.status,u.name AS "currentAssigneeName",u.username AS "currentAssigneeUsername" FROM tenkhah_settlements s LEFT JOIN "User" u ON u.id=s.current_assignee_user_id WHERE s.tenkhah_request_id=ANY($1::int[]) ORDER BY s.created_at DESC`, ids); const es = await prisma.$queryRawUnsafe(`SELECT id,settlement_id AS "settlementId",expense_date AS "expenseDate",description,budget_code AS "budgetCode",amount::text AS amount,file_name AS "fileName",file_url AS "fileUrl" FROM tenkhah_settlement_entries WHERE settlement_id=ANY($1::int[]) ORDER BY id`, data.map(x => x.id)); return data.map(s => ({ ...s, entries: es.filter(e => +e.settlementId === +s.id) })); }
const norm = (value = "") => String(value).toLowerCase().replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/\s+/g, " ");
async function settlementRecipients(stage, excludeId) {
  const users = await prisma.user.findMany({ include: { units: { include: { unit: true } }, roles: { include: { role: true } } }, orderBy: { id: "asc" } });
  const terms = stage === "control_project" ? ["برنامه ریزی", "برنامه‌ریزی", "برنامه ريزي", "برنامه‌ريزی", "planning"] : stage === "finance" ? ["مالی", "حسابداری", "حسابدار", "finance", "account"] : ["مدیر پروژه", "project manager"];
  let roleUnitMembers = new Set();
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT DISTINCT urm."userId" AS "userId", un.name AS "unitName" FROM "UserRoleMap" urm INNER JOIN "UnitRoleMap" urm2 ON urm2."roleId"=urm."roleId" INNER JOIN "Unit" un ON un.id=urm2."unitId"`);
    roleUnitMembers = new Set(rows.filter(row => terms.some(term => norm(row.unitName).includes(norm(term)))).map(row => +row.userId));
  } catch {}
  return users.filter(u => u.isActive !== false && +u.id !== +excludeId).filter(u =>
    roleUnitMembers.has(+u.id) || (u.units || []).some(link => terms.some(term => norm(link.unit?.name).includes(norm(term))))
  ).map(u => ({ id: u.id, name: u.name, username: u.username, email: u.email }));
}

export async function GET(r) {
  try {
    await ensure(); const uid = await userIdOf(r); if (!uid) return json({ error: "unauthorized" }, 401);
    const url = new URL(r.url), recipientStage = url.searchParams.get("recipients"), balanceProjectId = +url.searchParams.get("projectBalances");
    if (["control_project", "finance", "project_manager"].includes(recipientStage)) return json({ users: await settlementRecipients(recipientStage, uid) });
    if (balanceProjectId) { const rows = await prisma.$queryRawUnsafe(`SELECT COALESCE(SUM(GREATEST(0,t.requested_amount-COALESCE((SELECT SUM(e.amount) FROM tenkhah_settlements s JOIN tenkhah_settlement_entries e ON e.settlement_id=s.id WHERE s.tenkhah_request_id=t.id),0))),0)::text AS "unregisteredBalance",COALESCE(SUM(GREATEST(0,t.requested_amount-COALESCE((SELECT SUM(e.amount) FROM tenkhah_settlements s JOIN tenkhah_settlement_entries e ON e.settlement_id=s.id WHERE s.tenkhah_request_id=t.id AND s.status='completed'),0))),0)::text AS "unsettledBalance",COALESCE(SUM(CASE WHEN t.status='charged' THEN COALESCE(t.charged_amount,0) ELSE 0 END),0)::text AS "receivedAmount" FROM tenkhah_requests t WHERE t.project_id=$1 AND t.created_by_id=$2`, balanceProjectId, uid); return json(rows[0] || { unregisteredBalance: "0", unsettledBalance: "0", receivedAmount: "0" }); }
    const inbox = url.searchParams.get("inbox") === "1";
    const items = await requests(inbox ? "WHERE (t.current_assignee_user_id=$1 AND t.status='pending') OR EXISTS (SELECT 1 FROM tenkhah_settlements s WHERE s.tenkhah_request_id=t.id AND s.current_assignee_user_id=$1 AND s.status='pending')" : "WHERE t.created_by_id=$1 OR t.current_assignee_user_id=$1 OR EXISTS (SELECT 1 FROM tenkhah_settlements s WHERE s.tenkhah_request_id=t.id AND s.current_assignee_user_id=$1)", [uid]);
    const all = await settlements(items.map(x => x.id)); const shown = inbox ? all.filter(s => +s.currentAssigneeUserId === uid && s.status === "pending") : all.filter(s => +s.createdById === uid || +s.currentAssigneeUserId === uid);
    return json({ items: items.map(x => ({ ...x, settlements: all.filter(s => +s.tenkhahRequestId === +x.id) })), settlements: shown });
  } catch (e) { return json({ error: "internal_error", message: String(e?.message || e) }, 500); }
}

export async function POST(r) {
  try {
    await ensure(); const uid = await userIdOf(r); if (!uid) return json({ error: "unauthorized" }, 401); const b = await r.json().catch(() => ({}));
    if (b.action === "create_settlement") {
      const tid = +b.tenkhahRequestId, next = +b.sendToUserId, entries = Array.isArray(b.entries) ? b.entries : [], t = (await requests("WHERE t.id=$1", [tid]))[0];
      const settledAmount = entries.reduce((total, entry) => total + amount(entry.amount), 0n);
      if (!t || +t.createdById !== uid || !next || !entries.length || settledAmount <= 0n || settledAmount > BigInt(t.unregisteredBalance)) return json({ error: "invalid_settlement" }, 400);
      if (entries.some(e => !String(e.expenseDate || "").trim() || !String(e.budgetCode || "").trim() || amount(e.amount) <= 0n)) return json({ error: "invalid_entry" }, 400);
      const result = await prisma.$queryRawUnsafe("INSERT INTO tenkhah_settlements (tenkhah_request_id,created_by_id,current_assignee_user_id) VALUES ($1,$2,$3) RETURNING id", tid, uid, next);
      for (const e of entries) await prisma.$executeRawUnsafe("INSERT INTO tenkhah_settlement_entries (settlement_id,expense_date,description,budget_code,amount,file_name,file_url) VALUES ($1,$2,$3,$4,$5::bigint,$6,$7)", result[0].id, String(e.expenseDate), String(e.description || ""), String(e.budgetCode), String(amount(e.amount)), e.fileName || null, e.fileUrl || null);
      await prisma.$executeRawUnsafe("UPDATE tenkhah_requests SET unregistered_balance=unregistered_balance-$1::bigint,updated_at=CURRENT_TIMESTAMP WHERE id=$2", String(settledAmount), tid);
      return json({ ok: true }, 201);
    }
    const pid = +b.projectId, mid = +b.projectManagerId, w = amount(b.amount);
    if (!String(b.requestNumber || "").trim() || !String(b.requestDate || "").trim() || !pid || !mid || w <= 0n) return json({ error: "invalid_input" }, 400);
    // A tenkhah remains in its own tables and workflow.  The linked payment
    // request is a tracking identity only and is excluded from the normal
    // payment-request API, so its workflow can never be mixed with tenkhah.
    const linkedPayment = await prisma.paymentRequest.create({ data: {
      serial: String(b.requestNumber).trim(), dateJalali: String(b.requestDate), scope: "tenkhah",
      title: "درخواست تنخواه", amount: w, projectId: pid, docId: "tenkhah_request",
      createdById: uid, currentAssigneeUserId: mid, status: "pending",
    } });
    await prisma.$executeRawUnsafe("INSERT INTO tenkhah_requests (payment_request_id,request_number,request_date,project_id,requested_amount,currency,unregistered_balance,unsettled_balance,created_by_id,project_manager_id,current_assignee_user_id,project_liquidity) VALUES ($1,$2,$3,$4,$5::bigint,$6,$7::bigint,$8::bigint,$9,$10,$10,$11::bigint)", linkedPayment.id, String(b.requestNumber).trim(), String(b.requestDate), pid, String(w), String(b.currency || ""), String(w), String(w), uid, mid, String(amount(b.projectLiquidity)));
    return json({ ok: true }, 201);
  } catch (e) { return json({ error: "internal_error", message: String(e?.message || e) }, 500); }
}

export async function PATCH(r) {
  try {
    await ensure(); const uid = await userIdOf(r), b = await r.json().catch(() => ({}));
    if (b.action === "advance_settlement") {
      const s = (await prisma.$queryRawUnsafe("SELECT * FROM tenkhah_settlements WHERE id=$1", +b.settlementId))[0]; if (!s || +s.current_assignee_user_id !== uid || s.status !== "pending") return json({ error: "not_allowed" }, 403);
      if (s.stage === "project_manager") await prisma.$executeRawUnsafe("UPDATE tenkhah_settlements SET stage='requester_delivery',current_assignee_user_id=created_by_id,updated_at=CURRENT_TIMESTAMP WHERE id=$1", s.id);
      else if (s.stage === "requester_delivery") {
        const rows = await prisma.$queryRawUnsafe(`SELECT COALESCE(SUM(e.amount),0)::text AS total FROM tenkhah_settlement_entries e WHERE e.settlement_id=$1`, s.id);
        await prisma.$executeRawUnsafe("UPDATE tenkhah_requests SET unsettled_balance=GREATEST(0,unsettled_balance-$1::bigint),updated_at=CURRENT_TIMESTAMP WHERE id=$2", rows[0].total, s.tenkhah_request_id);
        await prisma.$executeRawUnsafe("UPDATE tenkhah_settlements SET stage='completed',status='completed',current_assignee_user_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1", s.id);
      } else { const next = +b.sendToUserId; if (!next) return json({ error: "next_user_required" }, 400); await prisma.$executeRawUnsafe("UPDATE tenkhah_settlements SET stage=$1,current_assignee_user_id=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3", s.stage === "control_project" ? "finance" : "project_manager", next, s.id); }
      return json({ ok: true });
    }
    const row = (await requests("WHERE t.id=$1", [+b.id]))[0]; if (!uid || !row || +row.currentAssigneeUserId !== uid || row.status !== "pending") return json({ error: "not_allowed" }, 403);
    if (row.stage === "project_manager") { if (!+b.financeUserId || !String(b.approvedDate || "").trim()) return json({ error: "invalid_input" }, 400); await prisma.$executeRawUnsafe("UPDATE tenkhah_requests SET finance_user_id=$1,current_assignee_user_id=$1,stage='finance',manager_approved_date=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3", +b.financeUserId, String(b.approvedDate), row.id); }
    else if (row.stage === "finance") await prisma.$executeRawUnsafe("UPDATE tenkhah_requests SET charged_date=$1,charged_amount=$2::bigint,status='charged',stage='completed',current_assignee_user_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$3", String(b.chargedDate || ""), String(amount(b.chargedAmount)), row.id);
    else return json({ error: "invalid_stage" }, 400);
    return json({ ok: true });
  } catch (e) { return json({ error: "internal_error", message: String(e?.message || e) }, 500); }
}
