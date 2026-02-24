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

function readCookieValue(cookie, name) {
  const safe = String(name || "").replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const re = new RegExp(`(?:^|;\\s*)${safe}=([^;]+)`);
  const m = String(cookie || "").match(re);
  return m ? decodeURIComponent(m[1]) : null;
}

async function getUserId(req) {
  const cookie = req.headers.get("cookie") || "";

  // Legacy support: x-user-id / user_id cookie
  const fromHeader = req.headers.get("x-user-id");
  const fromCookie = readCookieValue(cookie, "user_id");
  const direct = fromHeader || fromCookie;
  if (direct && /^\d+$/.test(String(direct))) return Number(direct);

  // Primary auth: ipm_session cookie
  const sessionId = readCookieValue(cookie, "ipm_session");
  if (sessionId) {
    // 1) Current schema path: Session.id
    try {
      const sess = await prisma.session.findUnique({
        where: { id: sessionId },
        include: { user: true },
      });
      if (sess?.user?.id && (!sess.expiresAt || new Date(sess.expiresAt).getTime() >= Date.now())) {
        return Number(sess.user.id);
      }
    } catch {}

    // 2) Backward compatibility: token-based sessions or alternate query path
    try {
      const sess = await prisma.session.findUnique({
        where: { token: sessionId },
      });
      if (sess?.userId && (!sess.expiresAt || new Date(sess.expiresAt).getTime() >= Date.now())) {
        return Number(sess.userId);
      }
    } catch {}

    // 3) Last fallback for odd schemas
    try {
      const sess = await prisma.session.findFirst({
        where: {
          OR: [{ id: sessionId }, { token: sessionId }],
        },
      });
      if (sess?.userId && (!sess.expiresAt || new Date(sess.expiresAt).getTime() >= Date.now())) {
        return Number(sess.userId);
      }
    } catch {}
  }

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

function isMainAdminObserver(user) {
  if (!user) return false;
  const uname = String(user.username || "").trim().toLowerCase();
  const email = String(user.email || "").trim().toLowerCase();
  return uname === "marandi" || email === "marandi@ipecgroup.net";
}

function unitNameToKind(unitNameOrCode) {
  const s = norm(unitNameOrCode).toLowerCase();

  // اگر کد گذاشتی مثل "office" / "finance" ...
  if (UNIT_KINDS.includes(s)) return s;

  // نگاشت بر اساس اسم فارسی رایج
  if (s.includes("دفتر") || s.includes("مرکز")) return "office";
  if (s.includes("سایت")) return "site";
  if (s.includes("مالی")) return "finance";
  if (s.includes("نقد")) return "cash";
  if (s.includes("سرمایه")) return "capex";
  if (s.includes("پروژه")) return "projects";

  // نگاشت انگلیسی رایج (برای code/name سفارشی)
  if (s.includes("office") || s.includes("hq") || s.includes("head") || s.includes("central")) return "office";
  if (s.includes("site")) return "site";
  if (s.includes("finance") || s.includes("account")) return "finance";
  if (s.includes("cash")) return "cash";
  if (s.includes("capex") || s.includes("capital")) return "capex";
  if (s.includes("project")) return "projects";

  return null;
}

function detectUserRoleKeys(roleNames) {
  const arr = (Array.isArray(roleNames) ? roleNames : [])
    .map((x) => norm(x).toLowerCase())
    .filter(Boolean);
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

function canActOnStep({ row, userId, userUnitKinds, userRoleKeys }) {
  const step = getCurrentStep(row.historyJson);
  if (!step) return false;

  // اگر برگشت خورده و step روی requester است، فقط سازنده حق اقدام دارد
  if (step.roleKey === ROLE_KEYS.REQUESTER) {
    return row.createdById === userId;
  }

  // نقش لازم را دارد؟
  if (!userRoleKeys.includes(step.roleKey)) return false;

  // به‌جز نقش دستور پرداخت، بقیه نقش‌ها باید در همان واحد درخواست باشند
  if (step.roleKey !== ROLE_KEYS.PAYMENT_ORDER) {
    const rowUnit = String(row.scope || "").toLowerCase();
    const units = Array.isArray(userUnitKinds) ? userUnitKinds : [];
    if (!rowUnit || !units.includes(rowUnit)) return false;
  }

  return true;
}

// --- user context (با مدل‌های واقعی Prisma شما)
async function getUserContext(req, userId) {
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
  });

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
  const roleDerivedUnitKinds = Array.from(
    new Set(
      roleNames
        .map((r) => unitNameToKind(r))
        .filter(Boolean)
    )
  );
  const departmentUnitKind = unitNameToKind(user?.department || "");

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
  const unitKinds = Array.from(
    new Set([
      ...mappedUnits.map((x) => x.kind).filter(Boolean),
      ...roleDerivedUnitKinds,
      ...(departmentUnitKind ? [departmentUnitKind] : []),
    ])
  );

  let unitKind = mappedUnits[0]?.kind || departmentUnitKind || roleDerivedUnitKinds[0] || null;

  if (mappedUnits.length > 1) {
    const wantsFinance = roleKeys.includes(ROLE_KEYS.ACCOUNTING) || roleKeys.includes(ROLE_KEYS.FINANCE_MANAGER);
    if (wantsFinance) {
      const fin = mappedUnits.find((x) => x.kind === "finance");
      if (fin) unitKind = "finance";
    }
  }

  // fallback هدرها برای dev
  if (!unitKind) {
    const hxUnit = norm(req.headers.get("x-user-unit")).toLowerCase();
    if (UNIT_KINDS.includes(hxUnit)) unitKind = hxUnit;
  }
  if (unitKind && !unitKinds.includes(unitKind)) unitKinds.push(unitKind);
  if ((!roleNames || roleNames.length === 0)) {
    const hxRoles = norm(req.headers.get("x-user-roles"));
    if (hxRoles) {
      const hdr = hxRoles.split(",").map((s) => s.trim()).filter(Boolean);
      for (const r of hdr) roleNames.push(r);
    }
  }

  return {
    isMainAdmin: isMainAdminObserver(user),
    unitKind,
    unitKinds,
    roleNames,
    roleKeys: detectUserRoleKeys(roleNames),
  };
}

// --- handlers
export async function GET(req, ctx) {
  const userId = await getUserId(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  const uctx = await getUserContext(req, userId);

  const slug = (ctx?.params?.slug || []).map(String);

  // GET /api/requests/:id
  if (slug.length === 1 && slug[0] !== "status") {
    const id = Number(slug[0]);
    if (!Number.isFinite(id)) return json({ error: "invalid_id" }, 400);

    const row = await prisma.paymentRequest.findUnique({ where: { id } });
    if (!row) return json({ error: "not_found" }, 404);
    const canAct = canActOnStep({
      row,
      userId,
      userUnitKinds: uctx.unitKinds,
      userRoleKeys: uctx.roleKeys,
    });
    const canView = uctx.isMainAdmin || row.createdById === userId || canAct;
    if (!canView) return json({ error: "forbidden" }, 403);

    return json({ item: { ...normalizeOut(row), canAct } });
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

  const rowsWithFlags = rows.map((r) => {
    const canAct = canActOnStep({
      row: r,
      userId,
      userUnitKinds: uctx.unitKinds,
      userRoleKeys: uctx.roleKeys,
    });
    const isMine = r.createdById === userId;
    const canView = uctx.isMainAdmin || isMine || canAct;
    return { row: r, canAct, isMine, canView };
  });

  let filtered = rowsWithFlags;
  if (view === "mine") {
    filtered = rowsWithFlags.filter((x) => x.isMine);
  } else if (view === "inbox") {
    filtered = uctx.isMainAdmin
      ? rowsWithFlags.filter((x) => !x.isMine)
      : rowsWithFlags.filter((x) => !x.isMine && x.canAct);
  } else {
    filtered = rowsWithFlags.filter((x) => x.canView);
  }

  return json({
    items: filtered.map((x) => ({
      ...normalizeOut(x.row),
      canAct: x.canAct,
    })),
  });
}

export async function POST(req, ctx) {
  const userId = await getUserId(req);
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
    if (!step) return json({ error: "no_active_step" }, 400);

    if (!canActOnStep({ row, userId, userUnitKinds: uctx.unitKinds, userRoleKeys: uctx.roleKeys })) {
      return json({ error: "forbidden" }, 403);
    }

    if (nextStatus === "approved") {
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
  const requestedScope = String(data.scope ?? body?.scope ?? "").trim().toLowerCase();
  let unitKind = uctx.unitKind;
  if (!unitKind && requestedScope && uctx.unitKinds.includes(requestedScope)) {
    unitKind = requestedScope;
  }
  if (!unitKind && uctx.isMainAdmin) {
    unitKind = UNIT_KINDS.includes(requestedScope) ? requestedScope : "office";
  }
  if (!unitKind) {
    return json(
      {
        error: "user_unit_required",
        hint: "کاربر باید به یک واحد معتبر متصل باشد (UserUnit / department / role name).",
      },
      400
    );
  }

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
  const userId = await getUserId(req);
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
  const userId = await getUserId(req);
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
