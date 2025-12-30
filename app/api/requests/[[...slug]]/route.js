// app/api/requests/[[...slug]]/route.js
import { PrismaClient } from "@prisma/client";

export const runtime = "nodejs";

const prisma = globalThis.__prisma_requests || new PrismaClient();
if (process.env.NODE_ENV !== "production") globalThis.__prisma_requests = prisma;

// --- helpers
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/**
 * IMPORTANT: این قسمت رو با Auth واقعی خودت هماهنگ کن.
 * فعلاً:
 * - اگر cookie با نام user_id داشته باشی می‌خونه
 * - یا header x-user-id
 * - در حالت dev اگر هیچکدام نبود، userId=1 می‌گذارد
 */
function getUserId(req) {
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)user_id=([^;]+)/);
  const fromCookie = m ? decodeURIComponent(m[1]) : null;

  const fromHeader = req.headers.get("x-user-id");
  const idStr = fromHeader || fromCookie;

  if (idStr && String(idStr).match(/^\d+$/)) return Number(idStr);

  if (process.env.NODE_ENV !== "production") return 1;
  return null;
}

function toBigIntSafe(v) {
  if (v == null) return null;
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
  const s = String(v).replace(/[,\s]/g, "").trim();
  if (!s) return null;
  if (!/^-?\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

function bigintToJson(v) {
  if (typeof v === "bigint") {
    const n = Number(v);
    if (Number.isSafeInteger(n)) return n;
    return v.toString();
  }
  return v;
}

function normalizeOut(row) {
  if (!row) return row;
  return {
    id: row.id,
    serial: row.serial,
    dateFa: row.dateJalali,
    date_jalali: row.dateJalali,
    scope: row.scope,
    title: row.title,
    description: row.description,

    amount: bigintToJson(row.amount),
    cashText: bigintToJson(row.cashAmount),
    cashDate: row.cashDateJalali,
    creditSection: bigintToJson(row.creditAmount),
    creditPay: row.creditPay,

    beneficiaryName: row.beneficiaryName,
    bankInfo: row.bankInfo,

    docId: row.docId,
    docOther: row.docOther,
    docNumber: row.docNumber,
    docDate: row.docDateJalali,

    currencyTypeId: row.currencyTypeId,
    currencySourceId: row.currencySourceId,

    projectId: row.projectId,
    budgetCode: row.budgetCode,

    status: row.status,
    history_json: row.historyJson,
    historyJson: row.historyJson,
    attachments: row.attachments,

    created_by_user_id: row.createdById,
    createdById: row.createdById,
    current_assignee_user_id: row.currentAssigneeUserId,
    currentAssigneeUserId: row.currentAssigneeUserId,

    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function pickUpdatable(body) {
  return {
    serial: body?.serial ?? body?.previewSerial ?? undefined,
    dateJalali:
      body?.dateJalali ??
      body?.dateFa ??
      body?.todayFa ??
      body?.date_jalali ??
      undefined,
    scope: body?.scope ?? undefined,
    title: body?.title ?? body?.titleInput ?? undefined,
    description: body?.description ?? body?.descInput ?? undefined,

    amount: toBigIntSafe(body?.amount ?? body?.amountStr) ?? undefined,
    cashAmount: toBigIntSafe(body?.cashAmount ?? body?.cashText) ?? undefined,
    cashDateJalali: body?.cashDateJalali ?? body?.cashDate ?? undefined,

    creditAmount: toBigIntSafe(body?.creditAmount ?? body?.creditSection) ?? undefined,
    creditPay: body?.creditPay ?? undefined,

    beneficiaryName: body?.beneficiaryName ?? undefined,
    bankInfo: body?.bankInfo ?? undefined,

    docId: body?.docId ?? undefined,
    docOther: body?.docOther ?? undefined,
    docNumber: body?.docNumber ?? undefined,
    docDateJalali: body?.docDateJalali ?? body?.docDate ?? undefined,

    currencyTypeId: body?.currencyTypeId != null ? Number(body.currencyTypeId) : undefined,
    currencySourceId: body?.currencySourceId != null ? Number(body.currencySourceId) : undefined,

    projectId: body?.projectId != null ? Number(body.projectId) : undefined,
    budgetCode: body?.budgetCode ?? undefined,

    attachments: body?.attachments ?? body?.docFiles ?? undefined,
  };
}

// =======================
// Workflow (طبق تصویر شما)
// =======================
const UNIT_KINDS = ["office", "site", "finance", "cash", "capex", "projects"];

const ROLE_KEYS = {
  REQUESTER: "requester",
  PROJECT_CONTROL: "project_control",
  PROJECT_MANAGER: "project_manager",
  ACCOUNTING: "accounting",
  FINANCE_MANAGER: "finance_manager",
  PAYMENT_ORDER: "payment_order",
};

function norm(s) {
  return String(s || "").trim();
}

function unitNameToKind(unitNameOrCode) {
  const s = norm(unitNameOrCode);

  // اگر کد گذاشتی مثل "office" / "finance" ...
  if (UNIT_KINDS.includes(s)) return s;

  // نگاشت بر اساس اسم فارسی رایج
  if (s.includes("دفتر") || s.includes("مرکز")) return "office";
  if (s.includes("سایت")) return "site";
  if (s.includes("مالی")) return "finance";
  if (s.includes("نقد")) return "cash";
  if (s.includes("سرمایه")) return "capex";
  if (s.includes("پروژه")) return "projects";

  return null;
}

function detectUserRoleKeys(roleNames) {
  const arr = (Array.isArray(roleNames) ? roleNames : []).map(norm).filter(Boolean);
  const keys = new Set();

  // نقش‌های دقیق از UserRole.name
  for (const r of arr) {
    // payment order
    if (r.includes("دستور") || r.includes("پرداخت") || r.includes("نوری") || r.includes("مرندی")) {
      keys.add(ROLE_KEYS.PAYMENT_ORDER);
      continue;
    }
    if (r.includes("مدیر مالی")) {
      keys.add(ROLE_KEYS.FINANCE_MANAGER);
      continue;
    }
    if (r.includes("حسابدار") || r.includes("حسابداری")) {
      keys.add(ROLE_KEYS.ACCOUNTING);
      continue;
    }
    if (r.includes("کنترل پروژه")) {
      keys.add(ROLE_KEYS.PROJECT_CONTROL);
      continue;
    }
    if (r.includes("مدیر پروژه")) {
      keys.add(ROLE_KEYS.PROJECT_MANAGER);
      continue;
    }

    // سایر نقش‌های درخواست‌کننده‌ها
    if (r.includes("کارشناس اداری") || r.includes("بازرگانی") || r.includes("سرپرست سایت") || r.includes("سرپرست کارگاه") || r.includes("درخواست")) {
      keys.add(ROLE_KEYS.REQUESTER);
    }
  }

  // اگر هیچ نقش خاصی نبود ولی نقش دارد، حداقل requester را بده (برای قفل نشدن dev)
  if (keys.size === 0 && arr.length) keys.add(ROLE_KEYS.REQUESTER);

  return Array.from(keys);
}

function getWorkflowChainForUnit(unitKind) {
  switch (unitKind) {
    case "office":
      return [ROLE_KEYS.REQUESTER, ROLE_KEYS.ACCOUNTING, ROLE_KEYS.FINANCE_MANAGER, ROLE_KEYS.PAYMENT_ORDER];
    case "site":
      return [ROLE_KEYS.REQUESTER, ROLE_KEYS.PROJECT_CONTROL, ROLE_KEYS.ACCOUNTING, ROLE_KEYS.FINANCE_MANAGER, ROLE_KEYS.PAYMENT_ORDER];
    case "finance":
      return [ROLE_KEYS.REQUESTER, ROLE_KEYS.FINANCE_MANAGER, ROLE_KEYS.PAYMENT_ORDER];
    case "cash":
      return [ROLE_KEYS.REQUESTER, ROLE_KEYS.PAYMENT_ORDER];
    case "capex":
      return [ROLE_KEYS.REQUESTER, ROLE_KEYS.PROJECT_CONTROL, ROLE_KEYS.ACCOUNTING, ROLE_KEYS.FINANCE_MANAGER, ROLE_KEYS.PAYMENT_ORDER];
    case "projects":
      return [ROLE_KEYS.REQUESTER, ROLE_KEYS.PROJECT_CONTROL, ROLE_KEYS.PROJECT_MANAGER, ROLE_KEYS.ACCOUNTING, ROLE_KEYS.FINANCE_MANAGER, ROLE_KEYS.PAYMENT_ORDER];
    default:
      return null;
  }
}

function getCurrentStep(historyJson) {
  const h = Array.isArray(historyJson) ? historyJson : [];
  for (let i = h.length - 1; i >= 0; i--) {
    const it = h[i];
    if (it && it.type === "step_set" && it.roleKey) return it;
    if (it && it.type === "step_clear") return null;
  }
  return null;
}

function canActOnStep({ row, userId, userUnitKind, userRoleKeys }) {
  const step = getCurrentStep(row.historyJson);
  if (!step) return false;

  // اگر برگشت خورده و step روی requester است، فقط سازنده حق اقدام دارد
  if (step.roleKey === ROLE_KEYS.REQUESTER) {
    return row.createdById === userId;
  }

  // نقش لازم را دارد؟
  if (!userRoleKeys.includes(step.roleKey)) return false;

  // شرط واحد برای نقش‌های مالی
  if (
    (step.roleKey === ROLE_KEYS.ACCOUNTING || step.roleKey === ROLE_KEYS.FINANCE_MANAGER) &&
    userUnitKind !== "finance"
  ) return false;

  return true;
}

// --- user context (با مدل‌های واقعی Prisma شما)
async function getUserContext(req, userId) {
  // 1) Units
  const userUnits = await prisma.userUnit.findMany({
    where: { userId: Number(userId) },
    include: { unit: true },
  });

  // 2) Roles
  const roleMaps = await prisma.userRoleMap.findMany({
    where: { userId: Number(userId) },
    include: { role: true },
  });
  const roleNames = (roleMaps || []).map((rm) => rm?.role?.name).filter(Boolean);

  // unitKind انتخابی:
  // اگر چندتا واحد داشت:
  // - اولویت با واحدی که قابل نگاشت باشد
  // - اگر نقش مالی/حسابداری دارد، finance را ترجیح بده
  const mappedUnits = (userUnits || [])
    .map((uu) => {
      const u = uu?.unit;
      const kind = unitNameToKind(u?.code || u?.name);
      return { kind, unit: u };
    })
    .filter((x) => !!x.kind);

  const roleKeys = detectUserRoleKeys(roleNames);

  let unitKind = mappedUnits[0]?.kind || null;

  if (mappedUnits.length > 1) {
    const wantsFinance = roleKeys.includes(ROLE_KEYS.ACCOUNTING) || roleKeys.includes(ROLE_KEYS.FINANCE_MANAGER);
    if (wantsFinance) {
      const fin = mappedUnits.find((x) => x.kind === "finance");
      if (fin) unitKind = "finance";
    }
  }

  // fallback هدرها برای dev
  if (!unitKind) {
    const hxUnit = norm(req.headers.get("x-user-unit"));
    if (UNIT_KINDS.includes(hxUnit)) unitKind = hxUnit;
  }
  if ((!roleNames || roleNames.length === 0)) {
    const hxRoles = norm(req.headers.get("x-user-roles"));
    if (hxRoles) {
      const hdr = hxRoles.split(",").map((s) => s.trim()).filter(Boolean);
      for (const r of hdr) roleNames.push(r);
    }
  }

  return {
    unitKind,
    roleNames,
    roleKeys: detectUserRoleKeys(roleNames),
  };
}

// --- handlers
export async function GET(req, ctx) {
  const userId = getUserId(req);
  if (!userId) return json({ error: "unauthorized" }, 401);

  const slug = (ctx?.params?.slug || []).map(String);

  // GET /api/requests/:id
  if (slug.length === 1 && slug[0] !== "status") {
    const id = Number(slug[0]);
    if (!Number.isFinite(id)) return json({ error: "invalid_id" }, 400);

    const row = await prisma.paymentRequest.findUnique({ where: { id } });
    if (!row) return json({ error: "not_found" }, 404);

    return json({ item: normalizeOut(row) });
  }

  // GET /api/requests (list)
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") || "";
  const status = url.searchParams.get("status") || "";
  const q = url.searchParams.get("q") || "";
  const view = url.searchParams.get("view") || ""; // mine | inbox

  const where = {
    ...(scope ? { scope } : {}),
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { serial: { contains: q, mode: "insensitive" } },
            { title: { contains: q, mode: "insensitive" } },
            { beneficiaryName: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  let rows = await prisma.paymentRequest.findMany({
    where,
    orderBy: { id: "desc" },
    take: 500,
  });

  if (view === "mine") {
    rows = rows.filter((r) => r.createdById === userId);
  } else if (view === "inbox") {
    const uctx = await getUserContext(req, userId);
    rows = rows.filter((r) => {
      if (r.status !== "pending") return false;
      const step = getCurrentStep(r.historyJson);
      if (!step) return false;

      if (step.roleKey === ROLE_KEYS.REQUESTER) return r.createdById === userId;

      return canActOnStep({
        row: r,
        userId,
        userUnitKind: uctx.unitKind,
        userRoleKeys: uctx.roleKeys,
      });
    });
  }

  return json({ items: rows.map(normalizeOut) });
}

export async function POST(req, ctx) {
  const userId = getUserId(req);
  if (!userId) return json({ error: "unauthorized" }, 401);

  const slug = (ctx?.params?.slug || []).map(String);

  // POST /api/requests/status   body: {id, status, note}
  if (slug.length === 1 && slug[0] === "status") {
    const body = (await readJson(req)) || {};
    const id = Number(body?.id);
    const nextStatus = String(body?.status || "").trim(); // approved/rejected/returned
    const note = (body?.note ?? "").toString();

    if (!Number.isFinite(id)) return json({ error: "invalid_id" }, 400);
    if (!["approved", "rejected", "returned"].includes(nextStatus))
      return json({ error: "invalid_status" }, 400);

    const row = await prisma.paymentRequest.findUnique({ where: { id } });
    if (!row) return json({ error: "not_found" }, 404);

    const uctx = await getUserContext(req, userId);
    const history = Array.isArray(row.historyJson) ? row.historyJson : [];
    const step = getCurrentStep(history);

    if (nextStatus === "approved") {
      if (!canActOnStep({ row, userId, userUnitKind: uctx.unitKind, userRoleKeys: uctx.roleKeys })) {
        return json({ error: "forbidden" }, 403);
      }

      const unitKind = row.scope;
      const chain = getWorkflowChainForUnit(unitKind);
      if (!chain) return json({ error: "workflow_not_defined" }, 400);

      const curIndex = typeof step?.index === "number" ? step.index : 1;
      const nextIndex = curIndex + 1;

      history.push({
        byUserId: userId,
        type: "approved",
        status: "pending",
        note,
        at: new Date().toISOString(),
        roleKey: step?.roleKey || null,
        index: curIndex,
      });

      if (nextIndex >= chain.length) {
        history.push({ type: "step_clear", at: new Date().toISOString() });

        const updated = await prisma.paymentRequest.update({
          where: { id },
          data: {
            status: "approved",
            historyJson: history,
          },
        });
        return json({ ok: true, item: normalizeOut(updated) });
      }

      const nextRoleKey = chain[nextIndex];
      history.push({
        type: "step_set",
        at: new Date().toISOString(),
        unitKind,
        roleKey: nextRoleKey,
        index: nextIndex,
      });

      const updated = await prisma.paymentRequest.update({
        where: { id },
        data: {
          status: "pending",
          historyJson: history,
        },
      });

      return json({ ok: true, item: normalizeOut(updated) });
    }

    // returned/rejected
    history.push({
      byUserId: userId,
      type: nextStatus,
      status: nextStatus,
      note,
      at: new Date().toISOString(),
      roleKey: step?.roleKey || null,
      index: typeof step?.index === "number" ? step.index : null,
    });

    let data = { status: nextStatus, historyJson: history };

    if (nextStatus === "rejected") {
      history.push({ type: "step_clear", at: new Date().toISOString() });
      data = { status: "rejected", historyJson: history };
    } else if (nextStatus === "returned") {
      history.push({
        type: "step_set",
        at: new Date().toISOString(),
        unitKind: row.scope,
        roleKey: ROLE_KEYS.REQUESTER,
        index: 0,
      });
      data = { status: "returned", historyJson: history };
    }

    const updated = await prisma.paymentRequest.update({ where: { id }, data });
    return json({ ok: true, item: normalizeOut(updated) });
  }

  // POST /api/requests (create)
  const body = (await readJson(req)) || {};
  const data = pickUpdatable(body);

  const uctx = await getUserContext(req, userId);
  if (!uctx.unitKind) return json({ error: "user_unit_required" }, 400);

  const unitKind = uctx.unitKind;
  const chain = getWorkflowChainForUnit(unitKind);
  if (!chain) return json({ error: "workflow_not_defined" }, 400);

  const title = data.title;
  const amountBI = data.amount ?? toBigIntSafe(body?.amountStr) ?? BigInt(0);

  if (!title) return json({ error: "title_required" }, 400);
  if (amountBI <= 0n) return json({ error: "amount_must_be_positive" }, 400);

  const enforcedScope = unitKind;

  const pendingIndex = chain.length > 1 ? 1 : 0;
  const pendingRoleKey = chain[pendingIndex];

  const nowIso = new Date().toISOString();

  const created = await prisma.paymentRequest.create({
    data: {
      serial: data.serial ?? null,
      dateJalali: data.dateJalali ?? null,
      scope: enforcedScope,
      title,
      description: data.description ?? null,

      amount: amountBI,
      cashAmount: data.cashAmount ?? null,
      cashDateJalali: data.cashDateJalali ?? null,

      creditAmount: data.creditAmount ?? null,
      creditPay: data.creditPay ?? null,

      beneficiaryName: data.beneficiaryName ?? null,
      bankInfo: data.bankInfo ?? null,

      docId: data.docId ?? null,
      docOther: data.docOther ?? null,
      docNumber: data.docNumber ?? null,
      docDateJalali: data.docDateJalali ?? null,

      currencyTypeId: data.currencyTypeId ?? null,
      currencySourceId: data.currencySourceId ?? null,

      projectId: data.projectId ?? null,
      budgetCode: data.budgetCode ?? null,

      attachments: data.attachments ?? null,

      createdById: userId,
      currentAssigneeUserId: null,

      status: "pending",
      historyJson: [
        {
          byUserId: userId,
          type: "created",
          status: "pending",
          note: "",
          at: nowIso,
          enforcedScope,
          userUnitKind: unitKind,
          userRoleNames: uctx.roleNames,
        },
        {
          type: "step_set",
          at: nowIso,
          unitKind,
          roleKey: pendingRoleKey,
          index: pendingIndex,
        },
      ],
    },
  });

  return json({ ok: true, item: normalizeOut(created) }, 201);
}

export async function PATCH(req, ctx) {
  const userId = getUserId(req);
  if (!userId) return json({ error: "unauthorized" }, 401);

  const slug = (ctx?.params?.slug || []).map(String);
  if (slug.length !== 1) return json({ error: "invalid_path" }, 400);

  const id = Number(slug[0]);
  if (!Number.isFinite(id)) return json({ error: "invalid_id" }, 400);

  const row = await prisma.paymentRequest.findUnique({ where: { id } });
  if (!row) return json({ error: "not_found" }, 404);

  // فقط سازنده (فعلاً)
  if (row.createdById !== userId) return json({ error: "forbidden" }, 403);

  const body = (await readJson(req)) || {};
  const data = pickUpdatable(body);

  if (data.amount == null) delete data.amount;
  if (data.cashAmount == null) delete data.cashAmount;
  if (data.creditAmount == null) delete data.creditAmount;

  const history = Array.isArray(row.historyJson) ? row.historyJson : [];
  history.push({
    byUserId: userId,
    type: "edited",
    status: row.status,
    note: "",
    at: new Date().toISOString(),
  });

  const updated = await prisma.paymentRequest.update({
    where: { id },
    data: { ...data, historyJson: history },
  });

  return json({ ok: true, item: normalizeOut(updated) });
}

export async function DELETE(req, ctx) {
  const userId = getUserId(req);
  if (!userId) return json({ error: "unauthorized" }, 401);

  const slug = (ctx?.params?.slug || []).map(String);
  if (slug.length !== 1) return json({ error: "invalid_path" }, 400);

  const id = Number(slug[0]);
  if (!Number.isFinite(id)) return json({ error: "invalid_id" }, 400);

  const row = await prisma.paymentRequest.findUnique({ where: { id } });
  if (!row) return json({ error: "not_found" }, 404);

  // فقط سازنده
  if (row.createdById !== userId) return json({ error: "forbidden" }, 403);

  await prisma.paymentRequest.delete({ where: { id } });
  return json({ ok: true });
}
