// app/api/requests/[[...slug]]/route.js
import { PrismaClient } from "@prisma/client";
import { fallbackUnitsForRoleNames } from "../../../../lib/orgStructureFallback";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { requirePagePermission } from "../../../../lib/pagePermissions";
import { nextSharedPaymentSerial } from "../../../../lib/paymentSerial";

export const runtime = "nodejs";

const prisma = globalThis.__prisma_requests || new PrismaClient();
if (process.env.NODE_ENV !== "production") globalThis.__prisma_requests = prisma;

// Supply requests deliberately share the underlying table with payment
// requests, but belong exclusively to /api/supply-requests. Keep this
// boundary at every entry point of the payment-request API.
const SUPPLY_REQUEST_DOC_ID = "supply_request";
const TENKHAH_REQUEST_DOC_ID = "tenkhah_request";
const paymentRequestOnlyWhere = {
  // `NOT IN` by itself excludes NULL in SQL.  The older payment requests did
  // not have a docId at all, so that condition made their historical
  // cartables disappear as well.  Keep null as a valid payment-request type.
  OR: [
    { docId: null },
    { docId: { notIn: [SUPPLY_REQUEST_DOC_ID, TENKHAH_REQUEST_DOC_ID] } },
  ],
};

function isSupplyRequest(row) {
  return row?.docId === SUPPLY_REQUEST_DOC_ID || row?.docId === TENKHAH_REQUEST_DOC_ID;
}

function attachmentServerIds(rows = []) {
  const ids = new Set();
  for (const row of rows) {
    for (const attachment of Array.isArray(row?.attachments) ? row.attachments : []) {
      const id = String(attachment?.serverId || "").trim();
      if (id) ids.add(id);
    }
  }
  return Array.from(ids);
}

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

async function getSlug(ctx) {
  const params = await Promise.resolve(ctx?.params || {});
  return (params?.slug || []).map(String);
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
  if (direct && /^\d+$/.test(String(direct))) {
    const directId = Number(direct);
    try {
      const user = await prisma.user.findUnique({ where: { id: directId }, select: { id: true } });
      if (user?.id) return directId;
    } catch {}
  }

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

function approvedByProjectManager(history) {
  return Array.isArray(history) && history.some(
    (entry) => entry?.type === "approved" && entry?.roleKey === "project_manager" && Number(entry?.index) === 2
  );
}

async function getProjectLiquidityRemaining(projectId) {
  // Keep this table available even when the liquidity screen has not been
  // opened yet. It is deliberately the same source used by the financial
  // dashboard: allocated budget minus project-manager-approved commitments.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS liquidity_allocations (
      id SERIAL PRIMARY KEY,
      allocation_date VARCHAR(20) NOT NULL,
      source VARCHAR(255) NOT NULL,
      available_amount BIGINT NOT NULL,
      description TEXT DEFAULT '',
      project_id INTEGER,
      amount BIGINT NOT NULL,
      created_by INTEGER,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const [allocatedRows, requests] = await Promise.all([
    prisma.$queryRawUnsafe(
      "SELECT COALESCE(SUM(amount), 0)::text AS amount FROM liquidity_allocations WHERE project_id = $1",
      Number(projectId)
    ),
    prisma.paymentRequest.findMany({
      where: { projectId: Number(projectId) },
      select: { amount: true, historyJson: true },
    }),
  ]);
  const allocated = toBigIntSafe(allocatedRows?.[0]?.amount) ?? 0n;
  const committed = requests.reduce(
    (sum, request) => approvedByProjectManager(request.historyJson)
      ? sum + (toBigIntSafe((Array.isArray(request.historyJson) ? request.historyJson.find((entry) => entry?.type === "created")?.rialAmount : null) ?? request.amount) ?? 0n)
      : sum,
    0n
  );
  return allocated - committed;
}

function normalizeDigits(value = "") {
  return String(value ?? "")
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function bigintToJson(v) {
  if (typeof v === "bigint") {
    const n = Number(v);
    if (Number.isSafeInteger(n)) return n;
    return v.toString();
  }
  return v;
}

function formatRegistrationDateTime(date = new Date()) {
  const dateJalali = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const time = new Intl.DateTimeFormat("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return { dateJalali: normalizeDigits(dateJalali), time: normalizeDigits(time) };
}

function clientDateTimeInfo(value) {
  const dateJalali = norm(value?.dateJalali ?? value?.date ?? "").replaceAll("-", "/");
  const time = norm(value?.time ?? "");
  const timezone = norm(value?.timezone ?? "");
  if (!dateJalali && !time) return null;
  return {
    ...(dateJalali ? { dateJalali: normalizeDigits(dateJalali) } : {}),
    ...(time ? { time: normalizeDigits(time) } : {}),
    ...(timezone ? { timezone } : {}),
  };
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function normalizeFaText(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\s+/g, " ");
}

function normalizeOut(row, userNamesById = null) {
  if (!row) return row;
  const history = Array.isArray(row.historyJson) ? row.historyJson : [];
  const createdMeta = history.find((entry) => entry?.type === "created") || {};
  const currentStep = getCurrentStep(history);
  const resolvedHistory = userNamesById
    ? history.map((entry) => {
        const name = userNamesById.get(Number(entry?.byUserId));
        return name ? { ...entry, actorName: name } : entry;
      })
    : history;
  return {
    id: row.id,
    serial: row.serial,
    dateFa: row.dateJalali,
    date_jalali: row.dateJalali,
    scope: row.scope,
    title: row.title,
    description: row.description,

    amount: bigintToJson(row.amount),
    exchangeRate: createdMeta.exchangeRate ?? null,
    rialAmount: createdMeta.rialAmount ?? bigintToJson(row.amount),
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
    history_json: resolvedHistory,
    historyJson: resolvedHistory,
    attachments: row.attachments,
    hasSupplyRequest: createdMeta.hasSupplyRequest || "no",
    supplyRequestId: createdMeta.supplyRequestId || null,
    relatedLetterIds: normalizeIdList(createdMeta.relatedLetterIds),
    registrationInfo: createdMeta.registrationInfo || null,

    created_by_user_id: row.createdById,
    createdById: row.createdById,
    createdByName:
      row.createdBy?.name ||
      row.createdBy?.username ||
      row.createdBy?.email ||
      null,
    current_assignee_user_id: row.currentAssigneeUserId,
    currentAssigneeUserId: row.currentAssigneeUserId,
    currentStepRoleKey: currentStep?.roleKey || null,
    currentStepIndex: typeof currentStep?.index === "number" ? currentStep.index : null,

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
    exchangeRate: toBigIntSafe(body?.exchangeRate) ?? undefined,
    rialAmount: toBigIntSafe(body?.rialAmount) ?? undefined,
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

    currencyTypeId:
      body?.currencyTypeId === "" || body?.currencyTypeId === null
        ? null
        : body?.currencyTypeId != null
          ? Number(body.currencyTypeId)
          : undefined,
    currencySourceId:
      body?.currencySourceId === "" || body?.currencySourceId === null
        ? null
        : body?.currencySourceId != null
          ? Number(body.currencySourceId)
          : undefined,

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
  MANAGEMENT: "management",
  PAYMENT_ORDER: "payment_order",
};

const PAYMENT_WORKFLOW_CHAIN = [
  ROLE_KEYS.REQUESTER,
  ROLE_KEYS.PROJECT_CONTROL,
  ROLE_KEYS.PROJECT_MANAGER,
  ROLE_KEYS.ACCOUNTING,
  ROLE_KEYS.MANAGEMENT,
  ROLE_KEYS.ACCOUNTING,
];

// These stages are unit queues: no previous actor chooses an individual
// recipient.  Every eligible member of the unit can see and act on them.
const SHARED_UNIT_ROLE_KEYS = new Set([
  ROLE_KEYS.PROJECT_CONTROL,
  ROLE_KEYS.MANAGEMENT,
  ROLE_KEYS.ACCOUNTING,
]);
const isSharedUnitRole = (roleKey) => SHARED_UNIT_ROLE_KEYS.has(roleKey);

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
      keys.add(ROLE_KEYS.ACCOUNTING);
      continue;
    }
    if (r.includes("حسابدار") || r.includes("حسابداری") || r.includes("مالی")) {
      keys.add(ROLE_KEYS.ACCOUNTING);
      continue;
    }
    if (r.includes("کنترل پروژه") || r.includes("برنامه ریزی") || r.includes("برنامه‌ریزی")) {
      keys.add(ROLE_KEYS.PROJECT_CONTROL);
      continue;
    }
    if (r.includes("مدیر پروژه")) {
      keys.add(ROLE_KEYS.PROJECT_MANAGER);
      continue;
    }
    if (
      r === "admin" ||
      r.includes("مدیریت") ||
      r.includes("مدیرعامل") ||
      r.includes("مدیر عامل") ||
      r.includes("هیئت مدیره") ||
      r.includes("هیات مدیره")
    ) {
      keys.add(ROLE_KEYS.MANAGEMENT);
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
  return unitKind === "projects" ? PAYMENT_WORKFLOW_CHAIN : PAYMENT_WORKFLOW_CHAIN;
}

function initialWorkflowRoleForUser(userContext) {
  // استثنا: درخواست ثبت‌شده توسط عضوی از مالی/حسابداری، مرحلهٔ مالی را
  // تکرار نمی‌کند و مستقیماً به مرحلهٔ مدیریت (دستور پرداخت) می‌رود.
  return hasWorkflowUnitForRole({ roleKey: ROLE_KEYS.ACCOUNTING, userUnitNames: userContext?.userUnitNames, roleUnitNames: userContext?.roleUnitNames })
    ? ROLE_KEYS.MANAGEMENT
    : ROLE_KEYS.PROJECT_CONTROL;
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

function legacyHistoryMentionsUser(entry, userId, knownNames) {
  const seen = new Set();
  const personKey = /(user|actor|assignee|approved|handled|performed|createdby|byuser|requester|owner)/i;
  const idKey = /(^id$|_id$|id$)/i;
  const nameKey = /(name|username|full_name|fullName)/i;

  function scan(value, key = "", insidePerson = false) {
    if (value == null) return false;
    if (typeof value !== "object") {
      if (insidePerson && idKey.test(key) && Number(value) === userId) return true;
      return insidePerson && nameKey.test(key) && knownNames.has(normalizeFaText(value));
    }
    if (seen.has(value)) return false;
    seen.add(value);
    return Object.entries(value).some(([childKey, childValue]) =>
      scan(childValue, childKey, insidePerson || personKey.test(childKey))
    );
  }

  return scan(entry);
}

function wasInvolvedInRequest(row, userId, { userUnitNames = [], roleUnitNames = [], isFinanceAppointmentMember = false, actorName = "", userName = "" } = {}) {
  const targetId = Number(userId);
  if (!Number.isFinite(targetId) || !row) return false;
  if (Number(row.createdById) === targetId || Number(row.currentAssigneeUserId) === targetId) return true;

  // The first version of the workflow saved a JSON object for some rows,
  // whereas newer rows save an array.  Treat both as history records.
  const history = Array.isArray(row.historyJson)
    ? row.historyJson
    : (row.historyJson && typeof row.historyJson === "object" ? [row.historyJson] : []);
  // Keep old requests visible too. Earlier workflow versions used several
  // different field names for the actor/assignee in historyJson, so only
  // checking the current names made historical requests disappear from the
  // tables of people who had already acted on them.
  const involvedByUser = history.some((entry) => [
    entry?.byUserId,
    entry?.assignedToUserId,
    entry?.targetAssigneeUserId,
    entry?.assigneeUserId,
    entry?.userId,
    entry?.actorId,
    entry?.actorUserId,
    entry?.performedByUserId,
    entry?.approvedByUserId,
    entry?.handledByUserId,
    entry?.assigned_to_user_id,
    entry?.target_assignee_user_id,
    entry?.user_id,
    entry?.actor?.id,
    entry?.user?.id,
    entry?.assignee?.id,
    entry?.assignedTo?.id,
    entry?.performedBy?.id,
  ].some((value) => Number(value) === targetId));
  if (involvedByUser) return true;

  // Some pre-workflow records kept only the actor's name. Match it against
  // the logged-in user's persisted name/username after Persian normalization
  // so those requests are restored without granting access to unrelated users.
  const knownNames = new Set([actorName, userName].map(normalizeFaText).filter(Boolean));
  const involvedByLegacyName = knownNames.size && history.some((entry) => [
    entry?.actorName,
    entry?.userName,
    entry?.performedByName,
    entry?.approvedByName,
    entry?.handledByName,
    entry?.actor?.name,
    entry?.user?.name,
  ].some((value) => knownNames.has(normalizeFaText(value))));
  if (involvedByLegacyName) return true;

  // Some early records used nested, snake_case action objects.  Scan only
  // user/actor-like branches, so a project or document id can never grant
  // visibility accidentally.
  if (history.some((entry) => legacyHistoryMentionsUser(entry, targetId, knownNames))) return true;

  // Shared-unit recipients remain involved after the request advances.
  return history.some((entry) => entry?.assignedToUnit === ROLE_KEYS.ACCOUNTING) && isFinanceAppointmentMember;
}

function canRejectAtStep(roleKey) {
  return [ROLE_KEYS.PROJECT_CONTROL, ROLE_KEYS.PROJECT_MANAGER].includes(roleKey);
}

function canReturnAtStep(roleKey) {
  return [
    ROLE_KEYS.PROJECT_CONTROL,
    ROLE_KEYS.PROJECT_MANAGER,
    ROLE_KEYS.ACCOUNTING,
    ROLE_KEYS.MANAGEMENT,
  ].includes(roleKey);
}

function includesAny(values, patterns) {
  const text = (Array.isArray(values) ? values : []).map((value) => normalizeFaText(value)).join(" ");
  return patterns.some((pattern) => text.includes(normalizeFaText(pattern)));
}

function hasWorkflowUnitForRole({ roleKey, userUnitNames, roleUnitNames = [] }) {
  // Workflow membership is intentionally derived only from explicit user-unit
  // assignments. Role, position and department wording must never route work.
  const unitNames = [...(Array.isArray(userUnitNames) ? userUnitNames : []), ...(Array.isArray(roleUnitNames) ? roleUnitNames : [])].map(normalizeFaText);
  const isProjectManagement = unitNames.some((name) => name.includes(normalizeFaText("مدیریت پروژه")) || name.includes("project management"));
  if (roleKey === ROLE_KEYS.PROJECT_CONTROL) return includesAny(unitNames, ["برنامه ریزی", "برنامه‌ریزی", "کنترل پروژه"]);
  if (roleKey === ROLE_KEYS.PROJECT_MANAGER) return isProjectManagement;
  if (roleKey === ROLE_KEYS.ACCOUNTING) return includesAny(unitNames, ["واحد مالی", "مالی", "حسابداری", "finance", "accounting"]);
  // The management stage must not include members of «مدیریت پروژه‌ها».
  if (roleKey === ROLE_KEYS.MANAGEMENT) return !isProjectManagement && includesAny(unitNames, ["مدیریت", "management"]);
  return false;
}

function canActOnStep({ row, userId, userUnitNames, roleUnitNames, isFinanceAppointmentMember = false }) {
  const step = getCurrentStep(row.historyJson);
  if (!step) return false;

  // Shared-unit queues must never be restricted to an individual assignee.
  if (step.roleKey === ROLE_KEYS.ACCOUNTING) {
    return isFinanceAppointmentMember;
  }

  // ارجاعِ مشخص به کاربر، اولویت دارد و کارتابل را فقط برای همان فرد می‌سازد.
  if (row.currentAssigneeUserId != null) return Number(row.currentAssigneeUserId) === Number(userId);

  // اگر برگشت خورده و step روی requester است، فقط سازنده حق اقدام دارد
  if (step.roleKey === ROLE_KEYS.REQUESTER) {
    return row.createdById === userId;
  }

  // جلوگیری از تایید/رد درخواستِ خودِ کاربر در سایر مراحل
  return hasWorkflowUnitForRole({ roleKey: step.roleKey, userUnitNames, roleUnitNames });
}

async function findWorkflowUsersForRole(roleKey, excludeUserId = null) {
  // Membership can be explicit (UserUnit) or inherited through the positions
  // assigned to a unit (UnitRoleMap -> UserRoleMap). No role-name text is read.
  const mappedMembers = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT urm."userId" AS "userId", un."name" AS "unitName", un."code" AS "unitCode"
    FROM "UserRoleMap" urm
    INNER JOIN "UnitRoleMap" unit_role ON unit_role."roleId" = urm."roleId"
    INNER JOIN "Unit" un ON un."id" = unit_role."unitId"
  `).catch(() => []);
  const mappedUserIds = new Set(
    mappedMembers
      .filter((row) => hasWorkflowUnitForRole({ roleKey, userUnitNames: [row?.unitName, row?.unitCode] }))
      .map((row) => Number(row.userId))
  );
  let users = [];
  try {
    users = await prisma.user.findMany({
      include: { units: { include: { unit: true } }, roles: { include: { role: true } } },
      orderBy: { id: "asc" },
      take: 500,
    });
  } catch {
    users = await prisma.user.findMany({ orderBy: { id: "asc" }, take: 500 });
  }
  return users.filter((candidate) => {
    const userUnitNames = [
      ...(Array.isArray(candidate.units) ? candidate.units.flatMap((row) => [row.unit?.name, row.unit?.code]).filter(Boolean) : []),
    ];
    const hasUnitAppointment = mappedUserIds.has(Number(candidate.id));
    return candidate.isActive !== false && (roleKey === ROLE_KEYS.ACCOUNTING
      ? hasUnitAppointment
      : hasUnitAppointment || hasWorkflowUnitForRole({ roleKey, userUnitNames }));
  });
}

function isGeneralProject(project) {
  return normalizeDigits(project?.code).trim() === "100" && normalizeFaText(project?.name).includes("عمومی");
}

async function findInitialWorkflowUsers(projectId, excludeUserId = null) {
  return findWorkflowUsersForRole(ROLE_KEYS.PROJECT_CONTROL, excludeUserId);
}

function serializeWorkflowUsers(users = []) {
  return users.map((candidate) => ({
    id: candidate.id,
    name: candidate.name || candidate.username || candidate.email || `کاربر #${candidate.id}`,
    username: candidate.username || null,
    email: candidate.email || null,
  }));
}

// --- user context (با مدل‌های واقعی Prisma شما)
async function getUserContext(req, userId) {
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
  });

  // 1) Units
  let userUnits = [];
  try {
    userUnits = await prisma.userUnit.findMany({
      where: { userId: Number(userId) },
      include: { unit: true },
    });
  } catch (err) {
    console.warn("requests_user_units_warn", err?.message || err);
  }

  // 2) Roles
  let roleMaps = [];
  try {
    roleMaps = await prisma.userRoleMap.findMany({
      where: { userId: Number(userId) },
      include: { role: true },
    });
  } catch (err) {
    console.warn("requests_user_roles_warn", err?.message || err);
  }
  const roleNames = (roleMaps || []).map((rm) => rm?.role?.name).filter(Boolean);
  if (user?.role && user.role !== "user" && !roleNames.includes(user.role)) roleNames.push(user.role);
  let unitRoleRows = [];
  try {
      // منبع قطعی عضویت سازمانی:
      // UserRoleMap (انتصاب کاربر) -> UnitRoleMap (واحد انتصاب) -> Unit
      // این کوئری عمداً بر پایهٔ شناسه‌هاست و هیچ حدس متنی در عضویت ندارد.
      const rows = await prisma.$queryRawUnsafe(`
        SELECT DISTINCT
          un."id" AS "unitId",
          un."name" AS "unitName",
          un."code" AS "unitCode",
          role."id" AS "roleId",
          role."name" AS "roleName"
        FROM "UserRoleMap" user_role
        INNER JOIN "UnitRoleMap" unit_role ON unit_role."roleId" = user_role."roleId"
        INNER JOIN "Unit" un ON un."id" = unit_role."unitId"
        INNER JOIN "UserRole" role ON role."id" = user_role."roleId"
        WHERE user_role."userId" = $1
        ORDER BY un."id" ASC, role."id" ASC
      `, Number(userId));
      unitRoleRows = rows.map((row) => ({
        unitId: Number(row.unitId),
        roleId: Number(row.roleId),
        unit: { id: Number(row.unitId), name: row.unitName, code: row.unitCode },
        role: { id: Number(row.roleId), name: row.roleName },
      }));
  } catch (err) {
    console.warn("requests_unit_roles_warn", err?.message || err);
  }
  unitRoleRows.forEach((row) => {
    const mappedRoleName = row?.role?.name;
    if (mappedRoleName && !roleNames.includes(mappedRoleName)) roleNames.push(mappedRoleName);
  });
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
  const unitNames = Array.from(
    new Set([
      ...(userUnits || []).map((row) => row?.unit?.name).filter(Boolean),
      ...unitRoleRows.map((row) => row?.unit?.name).filter(Boolean),
    ])
  );
  const userUnitNames = Array.from(new Set((userUnits || []).flatMap((row) => [row?.unit?.name, row?.unit?.code]).filter(Boolean)));
  const roleUnitNames = Array.from(
    new Set([
      ...unitRoleRows.flatMap((row) => [row?.unit?.name, row?.unit?.code]).filter(Boolean),
    ])
  );
  const isFinanceAppointmentMember = (await findWorkflowUsersForRole(ROLE_KEYS.ACCOUNTING))
    .some((candidate) => Number(candidate.id) === Number(userId));
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
    actorName: user?.name || user?.username || user?.email || `User #${userId}`,
    userName: user?.username || user?.name || user?.email || `کاربر #${userId}`,
    unitName: unitNames.join("، ") || "نامشخص",
    roleName: Array.from(new Set(roleNames)).join("، ") || "نامشخص",
    unitKind,
    unitKinds,
    unitNames,
    userUnitNames,
    roleUnitNames,
    isFinanceAppointmentMember,
    roleNames,
    roleKeys: detectUserRoleKeys(roleNames),
  };
}

async function userNameMapForRows(rows = []) {
  const ids = new Set();
  for (const row of rows) {
    if (row?.createdById) ids.add(Number(row.createdById));
    for (const entry of Array.isArray(row?.historyJson) ? row.historyJson : []) {
      if (entry?.byUserId) ids.add(Number(entry.byUserId));
    }
  }
  if (!ids.size) return new Map();

  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(ids) } },
    select: { id: true, name: true },
  });
  return new Map(
    users
      .filter((user) => String(user?.name || "").trim())
      .map((user) => [Number(user.id), String(user.name).trim()])
  );
}

// --- handlers
export async function GET(req, ctx) {
  const denied = await requirePagePermission(req, "درخواست پرداخت", "نمایش منو");
  if (denied) return denied;
  const userId = await getUserId(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  const uctx = await getUserContext(req, userId);

  const slug = await getSlug(ctx);
  const url = new URL(req.url);

  if (slug.length === 0 && url.searchParams.get("nextRecipientsForCreate") === "1") {
    const targetRoleKey = initialWorkflowRoleForUser(uctx);
    if (isSharedUnitRole(targetRoleKey)) return json({ targetRoleKey, users: [] });
    const users = targetRoleKey === ROLE_KEYS.MANAGEMENT
      ? await findWorkflowUsersForRole(targetRoleKey)
      : await findInitialWorkflowUsers(url.searchParams.get("projectId"));
    return json({ targetRoleKey, users: serializeWorkflowUsers(users) });
  }

  const nextRecipientsForItem = Number(url.searchParams.get("nextRecipientsForItem"));
  if (slug.length === 0 && Number.isFinite(nextRecipientsForItem) && nextRecipientsForItem > 0) {
    const row = await prisma.paymentRequest.findUnique({ where: { id: nextRecipientsForItem } });
    if (!row || isSupplyRequest(row)) return json({ error: "not_found" }, 404);
    const canAct = canActOnStep({ row, userId, userRoleKeys: uctx.roleKeys, userUnitNames: uctx.userUnitNames, roleUnitNames: uctx.roleUnitNames, isFinanceAppointmentMember: uctx.isFinanceAppointmentMember });
    if (!canAct) return json({ error: "forbidden" }, 403);
    const step = getCurrentStep(row.historyJson);
    const chain = getWorkflowChainForUnit(row.scope);
    const nextIndex = Number(step?.index ?? -1) + 1;
    const targetRoleKey = chain?.[nextIndex] || null;
    if (!targetRoleKey) return json({ targetRoleKey: null, users: [] });
    // Shared unit queues are routed directly to their unit, without exposing
    // individual recipients for the previous actor to choose from.
    if (isSharedUnitRole(targetRoleKey)) {
      return json({ targetRoleKey, users: [] });
    }
    const users = await findWorkflowUsersForRole(targetRoleKey);
    return json({ targetRoleKey, users: serializeWorkflowUsers(users) });
  }

  // GET /api/requests/:id
  if (slug.length === 1 && slug[0] !== "status") {
    const id = Number(slug[0]);
    if (!Number.isFinite(id)) return json({ error: "invalid_id" }, 400);

    const row = await prisma.paymentRequest.findUnique({
      where: { id },
      include: { createdBy: { select: { name: true, username: true, email: true } } },
    });
    if (!row || isSupplyRequest(row)) return json({ error: "not_found" }, 404);
    const canAct = canActOnStep({
      row,
      userId,
      userRoleKeys: uctx.roleKeys,
      userUnitNames: uctx.userUnitNames,
      roleUnitNames: uctx.roleUnitNames,
      isFinanceAppointmentMember: uctx.isFinanceAppointmentMember,
    });
    const canView = uctx.isMainAdmin || canAct || wasInvolvedInRequest(row, userId, uctx);
    if (!canView) return json({ error: "forbidden" }, 403);

    const userNamesById = await userNameMapForRows([row]);
    return json({ item: { ...normalizeOut(row, userNamesById), canAct, canDelete: row.createdById === userId && !["approved", "rejected", "canceled", "cancelled"].includes(row.status) } });
  }

  // GET /api/requests (list)
  const scope = url.searchParams.get("scope") || "";
  const status = url.searchParams.get("status") || "";
  const q = url.searchParams.get("q") || "";
  const view = url.searchParams.get("view") || ""; // mine | inbox

  const where = {
    ...paymentRequestOnlyWhere,
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
    include: { createdBy: { select: { name: true, username: true, email: true } } },
    orderBy: { id: "desc" },
    // Historical cartables must include older requests too; the former 500-row
    // cap could hide a user's earlier workflow items before involvement was
    // evaluated.
    take: 5000,
  });

  const rowsWithFlags = rows.map((r) => {
    const canAct = canActOnStep({
      row: r,
      userId,
      userRoleKeys: uctx.roleKeys,
      userUnitNames: uctx.userUnitNames,
      roleUnitNames: uctx.roleUnitNames,
      isFinanceAppointmentMember: uctx.isFinanceAppointmentMember,
    });
    const isMine = r.createdById === userId;
    const wasInvolved = wasInvolvedInRequest(r, userId, uctx);
    const canView = uctx.isMainAdmin || canAct || wasInvolved;
    return { row: r, canAct, isMine, wasInvolved, canView };
  });

  let filtered = rowsWithFlags;
  if (view === "mine") {
    filtered = rowsWithFlags.filter((x) => x.isMine);
  } else if (view === "inbox") {
    filtered = uctx.isMainAdmin
      ? rowsWithFlags.filter((x) => !x.isMine)
      : rowsWithFlags.filter((x) => !x.isMine && (x.canAct || x.wasInvolved));
  } else {
    filtered = rowsWithFlags.filter((x) => x.canView);
  }

  const userNamesById = await userNameMapForRows(filtered.map((x) => x.row));
  return json({
    items: filtered.map((x) => ({
      ...normalizeOut(x.row, userNamesById),
      canAct: x.canAct,
      canEdit: x.isMine,
      canDelete: x.isMine && !["approved", "rejected", "canceled", "cancelled"].includes(x.row.status),
    })),
  });
}

export async function POST(req, ctx) {
  const denied = await requirePagePermission(req, "درخواست پرداخت", "افزودن");
  if (denied) return denied;
  const userId = await getUserId(req);
  if (!userId) return json({ error: "unauthorized" }, 401);

  const slug = await getSlug(ctx);

  // POST /api/requests/status   body: {id, status, note}
  if (slug.length === 1 && slug[0] === "status") {
    const body = (await readJson(req)) || {};
    const id = Number(body?.id);
    const nextStatus = String(body?.status || "").trim(); // approved/rejected/returned
    const note = (body?.note ?? "").toString();
    const targetAssigneeUserId = Number(body?.targetAssigneeUserId ?? body?.target_assignee_user_id);

    if (!Number.isFinite(id)) return json({ error: "invalid_id" }, 400);
    if (!["approved", "rejected", "returned"].includes(nextStatus))
      return json({ error: "invalid_status" }, 400);

    const row = await prisma.paymentRequest.findUnique({ where: { id } });
    if (!row || isSupplyRequest(row)) return json({ error: "not_found" }, 404);

    const uctx = await getUserContext(req, userId);
    const history = Array.isArray(row.historyJson) ? row.historyJson : [];
    const step = getCurrentStep(history);
    if (!step) return json({ error: "no_active_step" }, 400);
    if (nextStatus === "rejected" && !canRejectAtStep(step.roleKey)) {
      return json({ error: "reject_not_allowed_for_step" }, 403);
    }
    if (nextStatus === "returned" && !canReturnAtStep(step.roleKey)) {
      return json({ error: "return_not_allowed_for_step" }, 403);
    }

    if (!canActOnStep({
      row,
      userId,
      userRoleKeys: uctx.roleKeys,
      userUnitNames: uctx.userUnitNames,
      roleUnitNames: uctx.roleUnitNames,
      isFinanceAppointmentMember: uctx.isFinanceAppointmentMember,
    })) {
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
        actorName: uctx.actorName,
        type: "approved",
        status: "pending",
        note,
        at: new Date().toISOString(),
        roleKey: step?.roleKey || null,
        index: curIndex,
      });

      if (nextIndex >= chain.length) {
        history.push({ type: "step_clear", at: new Date().toISOString() });

        const finalCashAmount = toBigIntSafe(body?.cashAmount);
        const finalCreditAmount = toBigIntSafe(body?.creditAmount);

        const updated = await prisma.paymentRequest.update({
          where: { id },
          data: {
            status: "approved",
            currentAssigneeUserId: null,
            historyJson: history,
            cashAmount: finalCashAmount ?? row.cashAmount,
            creditAmount: finalCreditAmount ?? row.creditAmount,
          },
        });
        return json({ ok: true, item: normalizeOut(updated) });
      }

      const nextRoleKey = chain[nextIndex];
      const workflowUsers = await findWorkflowUsersForRole(nextRoleKey);
      const isSharedUnitStep = isSharedUnitRole(nextRoleKey);
      if (isSharedUnitStep && workflowUsers.length === 0) {
        return json({ error: "workflow_unit_users_not_found" }, 400);
      }
      const nextAssignee = isSharedUnitStep
        ? null
        : workflowUsers.find((candidate) => Number(candidate.id) === targetAssigneeUserId);
      if (!isSharedUnitStep && !nextAssignee) {
        return json({ error: targetAssigneeUserId ? "target_assignee_invalid" : "target_assignee_required" }, 400);
      }
      history.push({
        type: "step_set",
        at: new Date().toISOString(),
        unitKind,
        roleKey: nextRoleKey,
        index: nextIndex,
        ...(nextAssignee ? { assignedToUserId: Number(nextAssignee.id) } : { assignedToUnit: nextRoleKey }),
      });

      const updated = await prisma.paymentRequest.update({
        where: { id },
        data: {
          status: "pending",
          currentAssigneeUserId: nextAssignee ? Number(nextAssignee.id) : null,
          historyJson: history,
        },
      });

      return json({ ok: true, item: normalizeOut(updated) });
    }

    // returned/rejected
    history.push({
      byUserId: userId,
      actorName: uctx.actorName,
      type: nextStatus,
      status: nextStatus,
      note,
      at: new Date().toISOString(),
      roleKey: step?.roleKey || null,
      index: typeof step?.index === "number" ? step.index : null,
    });

    let data = { status: nextStatus, currentAssigneeUserId: null, historyJson: history };

    if (nextStatus === "rejected") {
      history.push({ type: "step_clear", at: new Date().toISOString() });
      data = { status: "rejected", currentAssigneeUserId: null, historyJson: history };
    } else if (nextStatus === "returned") {
      history.push({
        type: "step_set",
        at: new Date().toISOString(),
        unitKind: row.scope,
        roleKey: ROLE_KEYS.REQUESTER,
        index: 0,
      });
      data = { status: "returned", currentAssigneeUserId: Number(row.createdById), historyJson: history };
    }

    const updated = await prisma.paymentRequest.update({ where: { id }, data });
    return json({ ok: true, item: normalizeOut(updated) });
  }

  // POST /api/requests (create)
  const body = (await readJson(req)) || {};
  const data = pickUpdatable(body);

  const uctx = await getUserContext(req, userId);
  const requestedScope = String(data.scope ?? body?.scope ?? "").trim().toLowerCase();
  const unitKind = UNIT_KINDS.includes(requestedScope)
    ? requestedScope
    : (uctx.unitKind || "office");

  const title = data.title;
  const amountBI = data.amount ?? toBigIntSafe(body?.amountStr) ?? BigInt(0);

  if ([SUPPLY_REQUEST_DOC_ID, TENKHAH_REQUEST_DOC_ID].includes(data.docId)) return json({ error: "invalid_doc_type" }, 400);
  if (!title) return json({ error: "title_required" }, 400);
  if (!data.projectId) return json({ error: "project_required" }, 400);
  if (!data.budgetCode) return json({ error: "budget_code_required" }, 400);
  if (amountBI <= 0n) return json({ error: "amount_must_be_positive" }, 400);

  const exchangeRateBI = data.currencyTypeId == null ? 1n : data.exchangeRate;
  if (exchangeRateBI == null || exchangeRateBI <= 0n) return json({ error: "exchange_rate_required" }, 400);
  const rialAmountBI = amountBI * exchangeRateBI;

  const liquidityRemaining = await getProjectLiquidityRemaining(data.projectId);
  if (rialAmountBI > liquidityRemaining) {
    return json({ error: "amount_exceeds_project_liquidity", liquidityRemaining: liquidityRemaining.toString() }, 400);
  }

  const targetAssigneeUserId = Number(body?.targetAssigneeUserId ?? body?.target_assignee_user_id);
  const initialRoleKey = initialWorkflowRoleForUser(uctx);
  const workflowUsers = initialRoleKey === ROLE_KEYS.MANAGEMENT
    ? await findWorkflowUsersForRole(initialRoleKey)
    : await findInitialWorkflowUsers(data.projectId);
  const isSharedInitialStep = isSharedUnitRole(initialRoleKey);
  if (isSharedInitialStep && workflowUsers.length === 0) return json({ error: "workflow_unit_users_not_found" }, 400);
  const initialAssignee = isSharedInitialStep ? null : workflowUsers.find((candidate) => Number(candidate.id) === targetAssigneeUserId);
  if (!isSharedInitialStep && !initialAssignee) return json({ error: targetAssigneeUserId ? "target_assignee_invalid" : "target_assignee_required" }, 400);

  const enforcedScope = "projects";
  const generatedSerial = await nextSharedPaymentSerial(prisma, { dateJalali: data.dateJalali, projectId: data.projectId });
  if (!generatedSerial) return json({ error: "serial_generation_failed" }, 400);

  const now = new Date();
  const nowIso = now.toISOString();
  const registrationInfo = {
    ...formatRegistrationDateTime(now),
    ...(clientDateTimeInfo(body?.clientRegistrationInfo) || {}),
    userId,
    userName: uctx.userName,
    unitName: uctx.unitName,
    roleName: uctx.roleName,
  };

  const created = await prisma.paymentRequest.create({
    data: {
      serial: generatedSerial,
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
      currentAssigneeUserId: initialAssignee ? Number(initialAssignee.id) : null,

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
          hasSupplyRequest: body?.hasSupplyRequest === "yes" ? "yes" : "no",
          supplyRequestId: body?.hasSupplyRequest === "yes" ? String(body?.supplyRequestId || "") : null,
          relatedLetterIds: normalizeIdList(body?.relatedLetterIds ?? body?.related_letter_ids),
          registrationInfo,
          exchangeRate: exchangeRateBI.toString(),
          rialAmount: rialAmountBI.toString(),
        },
        {
          type: "step_set",
          at: nowIso,
          unitKind: enforcedScope,
          roleKey: initialRoleKey,
          index: PAYMENT_WORKFLOW_CHAIN.indexOf(initialRoleKey),
          ...(initialAssignee ? { assignedToUserId: Number(initialAssignee.id) } : { assignedToUnit: initialRoleKey }),
        },
      ],
    },
  });

  return json({ ok: true, item: normalizeOut(created) }, 201);
}

export async function PATCH(req, ctx) {
  const userId = await getUserId(req);
  if (!userId) return json({ error: "unauthorized" }, 401);

  const slug = await getSlug(ctx);
  if (slug.length !== 1) return json({ error: "invalid_path" }, 400);

  const id = Number(slug[0]);
  if (!Number.isFinite(id)) return json({ error: "invalid_id" }, 400);

  const row = await prisma.paymentRequest.findUnique({ where: { id } });
  if (!row || isSupplyRequest(row)) return json({ error: "not_found" }, 404);

  // فقط سازنده (فعلاً)
  if (row.createdById !== userId) return json({ error: "forbidden" }, 403);

  const body = (await readJson(req)) || {};
  const data = pickUpdatable(body);
  if ([SUPPLY_REQUEST_DOC_ID, TENKHAH_REQUEST_DOC_ID].includes(data.docId)) return json({ error: "invalid_doc_type" }, 400);

  // A requester may edit their own request, but its approved/requested amount
  // is immutable after creation. Enforce this server-side as well as in the UI.
  delete data.amount;
  delete data.exchangeRate;
  delete data.rialAmount;
  if (data.cashAmount == null) delete data.cashAmount;
  if (data.creditAmount == null) delete data.creditAmount;

  const history = Array.isArray(row.historyJson) ? [...row.historyJson] : [];
  const supplyMetaTouched =
    Object.prototype.hasOwnProperty.call(body, "hasSupplyRequest") ||
    Object.prototype.hasOwnProperty.call(body, "supplyRequestId") ||
    Object.prototype.hasOwnProperty.call(body, "relatedLetterIds") ||
    Object.prototype.hasOwnProperty.call(body, "related_letter_ids");
  if (supplyMetaTouched) {
    const createdIndex = history.findIndex((entry) => entry?.type === "created");
    if (createdIndex >= 0) {
      const previous = history[createdIndex] || {};
      const hasSupplyRequest = Object.prototype.hasOwnProperty.call(body, "hasSupplyRequest")
        ? (body?.hasSupplyRequest === "yes" ? "yes" : "no")
        : (previous.hasSupplyRequest || (body?.supplyRequestId ? "yes" : "no"));
      const supplyRequestId = Object.prototype.hasOwnProperty.call(body, "supplyRequestId")
        ? String(body?.supplyRequestId || "")
        : String(previous.supplyRequestId || "");
      history[createdIndex] = {
        ...previous,
        hasSupplyRequest,
        supplyRequestId: hasSupplyRequest === "yes" ? supplyRequestId : null,
        relatedLetterIds: (
          Object.prototype.hasOwnProperty.call(body, "relatedLetterIds") ||
          Object.prototype.hasOwnProperty.call(body, "related_letter_ids")
        )
          ? normalizeIdList(body?.relatedLetterIds ?? body?.related_letter_ids)
          : normalizeIdList(previous.relatedLetterIds),
      };
    }
  }
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

  const slug = await getSlug(ctx);
  if (slug.length === 1 && slug[0] === "reset") {
    const uctx = await getUserContext(req, userId);
    if (!uctx.isMainAdmin) return json({ error: "forbidden" }, 403);
    const paymentRows = await prisma.paymentRequest.findMany({
      where: paymentRequestOnlyWhere,
      select: { attachments: true },
    });
    const attachmentIds = attachmentServerIds(paymentRows);
    const docs = attachmentIds.length
      ? await prisma.paymentDoc.findMany({ where: { id: { in: attachmentIds } }, select: { id: true, storedName: true } })
      : [];
    const deleted = await prisma.paymentRequest.deleteMany({ where: paymentRequestOnlyWhere });
    if (attachmentIds.length) await prisma.paymentDoc.deleteMany({ where: { id: { in: attachmentIds } } });
    await Promise.all(docs.map((doc) => unlink(path.join(process.cwd(), "public", "uploads", "payment-doc", doc.storedName)).catch(() => {})));
    return json({ ok: true, deleted: deleted.count });
  }
  if (slug.length !== 1) return json({ error: "invalid_path" }, 400);

  const id = Number(slug[0]);
  if (!Number.isFinite(id)) return json({ error: "invalid_id" }, 400);

  const row = await prisma.paymentRequest.findUnique({ where: { id } });
  if (!row || isSupplyRequest(row)) return json({ error: "not_found" }, 404);

  // فقط سازنده
  if (row.createdById !== userId) return json({ error: "forbidden" }, 403);
  if (["approved", "rejected", "canceled", "cancelled"].includes(row.status)) return json({ error: "delete_not_allowed" }, 400);

  await prisma.paymentRequest.delete({ where: { id } });
  return json({ ok: true });
}
