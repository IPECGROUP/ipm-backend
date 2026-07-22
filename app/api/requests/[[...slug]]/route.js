// app/api/requests/[[...slug]]/route.js
import { PrismaClient } from "@prisma/client";
import { fallbackUnitsForRoleNames } from "../../../../lib/orgStructureFallback";

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

function normalizeDigits(value = "") {
  return String(value ?? "")
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function jalaliYY(value) {
  const fromValue = normalizeDigits(String(value || "")).match(/^(\d{4})/)?.[1];
  if (fromValue) return fromValue.slice(-2);
  try {
    const year = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { year: "numeric" }).format(new Date());
    return normalizeDigits(year).slice(-2);
  } catch {
    return "00";
  }
}

function normalizeProjectCode(value = "") {
  const raw = normalizeDigits(value).trim();
  if (/^\d{3}$/.test(raw)) return raw;
  return raw.match(/^(\d{3})/)?.[1] || "";
}

async function makePaymentSerial({ dateJalali }) {
  const yy = jalaliYY(dateJalali);
  const prefix = `${yy}/`;
  const rows = await prisma.paymentRequest.findMany({
    where: {
      serial: { startsWith: prefix },
      OR: [{ docId: null }, { NOT: { docId: "supply_request" } }],
    },
    select: { serial: true },
    take: 1000,
  });

  let maxSeq = 0;
  const re = new RegExp(`^${yy}/(?:\\d{3}/)?(\\d{4})$`);
  for (const row of rows) {
    const m = normalizeDigits(row?.serial || "").match(re);
    if (m) maxSeq = Math.max(maxSeq, Number(m[1]) || 0);
  }

  return `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
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

function inferredUnitNamesFromRoles(roleNames = []) {
  const units = new Set();
  for (const raw of Array.isArray(roleNames) ? roleNames : []) {
    const role = normalizeFaText(raw);
    if (!role) continue;

    if (
      role === "admin" ||
      role.includes("مدیریت ارشد") ||
      role.includes("رئیس هیات مدیره") ||
      role.includes("رییس هیات مدیره") ||
      role.includes("هیات مدیره") ||
      role.includes("مدیرعامل") ||
      role.includes("مدیر عامل")
    ) {
      units.add("مدیریت");
    }

    if (
      role.includes("مسئول اداری") ||
      role.includes("مسوول اداری") ||
      role.includes("اداری") ||
      role.includes("منابع انسانی") ||
      role.includes("hr")
    ) {
      units.add("منابع انسانی و اداری");
    }

    if (
      role.includes("برنامه ریزی") ||
      role.includes("برنامه‌ریزی") ||
      role.includes("کنترل پروژه") ||
      role.includes("مدیر برنامه")
    ) {
      units.add("برنامه ریزی و کنترل پروژه");
    }

    if (role.includes("مالی") || role.includes("حسابدار") || role.includes("حسابداری")) {
      units.add("مالی");
    }

    if (role.includes("تامین") || role.includes("تأمین") || role.includes("بازرگانی")) {
      units.add("تامین و پشتیبانی");
    }
  }
  return Array.from(units);
}

function normalizeOut(row) {
  if (!row) return row;
  const history = Array.isArray(row.historyJson) ? row.historyJson : [];
  const createdMeta = history.find((entry) => entry?.type === "created") || {};
  const currentStep = getCurrentStep(history);
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

function getCurrentStep(historyJson) {
  const h = Array.isArray(historyJson) ? historyJson : [];
  for (let i = h.length - 1; i >= 0; i--) {
    const it = h[i];
    if (it && it.type === "step_set" && it.roleKey) return it;
    if (it && it.type === "step_clear") return null;
  }
  return null;
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

function hasWorkflowUnitForRole({ roleKey, userUnitNames, roleUnitNames, roleNames }) {
  const combinedUnitNames = [...(userUnitNames || []), ...(roleUnitNames || [])];
  if (roleKey === ROLE_KEYS.PROJECT_MANAGER) return true;
  if (roleKey === ROLE_KEYS.PROJECT_CONTROL) {
    return includesAny(combinedUnitNames, ["برنامه ریزی", "برنامه‌ریزی", "کنترل پروژه"]) || includesAny(roleNames, ["برنامه ریزی", "برنامه‌ریزی", "کنترل پروژه"]);
  }
  if (roleKey === ROLE_KEYS.ACCOUNTING) {
    return includesAny(combinedUnitNames, ["مالی", "حسابداری"]) || includesAny(roleNames, ["مالی", "حسابداری", "حسابدار"]);
  }
  if (roleKey === ROLE_KEYS.MANAGEMENT) {
    return includesAny(combinedUnitNames, ["مدیریت"]) || includesAny(roleNames, ["مدیریت", "مدیرعامل", "مدیر عامل", "هیئت مدیره", "هیات مدیره"]);
  }
  return true;
}

function canActOnStep({ row, userId, userRoleKeys, userUnitNames, roleUnitNames, roleNames }) {
  const step = getCurrentStep(row.historyJson);
  if (!step) return false;

  // ارجاعِ مشخص به کاربر، اولویت دارد و کارتابل را فقط برای همان فرد می‌سازد.
  if (row.currentAssigneeUserId != null) return Number(row.currentAssigneeUserId) === Number(userId);

  // اگر برگشت خورده و step روی requester است، فقط سازنده حق اقدام دارد
  if (step.roleKey === ROLE_KEYS.REQUESTER) {
    return row.createdById === userId;
  }

  // جلوگیری از تایید/رد درخواستِ خودِ کاربر در سایر مراحل
  if (row.createdById === userId) return false;

  // نقش لازم را دارد؟
  if (!userRoleKeys.includes(step.roleKey)) return false;

  return hasWorkflowUnitForRole({ roleKey: step.roleKey, userUnitNames, roleUnitNames, roleNames });
}

async function findWorkflowUsersForRole(roleKey, excludeUserId = null) {
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
    if (excludeUserId && Number(candidate.id) === Number(excludeUserId)) return false;
    const roleNames = [
      ...(Array.isArray(candidate.roles) ? candidate.roles.map((row) => row.role?.name).filter(Boolean) : []),
      candidate.role && candidate.role !== "user" ? candidate.role : "",
    ].filter(Boolean);
    const userUnitNames = [
      ...(Array.isArray(candidate.units) ? candidate.units.map((row) => row.unit?.name).filter(Boolean) : []),
      ...fallbackUnitsForRoleNames(roleNames),
      ...inferredUnitNamesFromRoles(roleNames),
    ];
    return detectUserRoleKeys(roleNames).includes(roleKey) && hasWorkflowUnitForRole({ roleKey, userUnitNames, roleUnitNames: [], roleNames });
  });
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
  const roleIds = (roleMaps || []).map((rm) => Number(rm?.roleId)).filter(Boolean);
  let unitRoleRows = [];
  if (roleIds.length) {
    try {
      unitRoleRows = await prisma.unitRoleMap.findMany({
          where: { roleId: { in: roleIds } },
          include: { unit: true, role: true },
          orderBy: [{ unitId: "asc" }, { roleId: "asc" }],
        });
    } catch (err) {
      console.warn("requests_unit_roles_warn", err?.message || err);
    }
  }
  if (roleNames.length) {
    try {
      const byNameRows = await prisma.unitRoleMap.findMany({
        where: { role: { name: { in: roleNames } } },
        include: { unit: true, role: true },
        orderBy: [{ unitId: "asc" }, { roleId: "asc" }],
      });
      const seen = new Set(unitRoleRows.map((row) => `${row.unitId}:${row.roleId}`));
      byNameRows.forEach((row) => {
        const key = `${row.unitId}:${row.roleId}`;
        if (!seen.has(key)) unitRoleRows.push(row);
      });
    } catch (err) {
      console.warn("requests_unit_roles_by_name_warn", err?.message || err);
    }
  }
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
      ...fallbackUnitsForRoleNames(roleNames),
      ...inferredUnitNamesFromRoles(roleNames),
    ])
  );
  const userUnitNames = Array.from(new Set((userUnits || []).map((row) => row?.unit?.name).filter(Boolean)));
  const roleUnitNames = Array.from(
    new Set([
      ...unitRoleRows.map((row) => row?.unit?.name).filter(Boolean),
      ...fallbackUnitsForRoleNames(roleNames),
      ...inferredUnitNamesFromRoles(roleNames),
    ])
  );
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
    userName: user?.username || user?.name || user?.email || `کاربر #${userId}`,
    unitName: unitNames.join("، ") || "نامشخص",
    roleName: Array.from(new Set(roleNames)).join("، ") || "نامشخص",
    unitKind,
    unitKinds,
    unitNames,
    userUnitNames,
    roleUnitNames,
    roleNames,
    roleKeys: detectUserRoleKeys(roleNames),
  };
}

// --- handlers
export async function GET(req, ctx) {
  const userId = await getUserId(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  const uctx = await getUserContext(req, userId);

  const slug = await getSlug(ctx);
  const url = new URL(req.url);

  if (slug.length === 0 && url.searchParams.get("nextRecipientsForCreate") === "1") {
    const targetRoleKey = ROLE_KEYS.PROJECT_CONTROL;
    const users = await findWorkflowUsersForRole(targetRoleKey, userId);
    return json({ targetRoleKey, users: serializeWorkflowUsers(users) });
  }

  const nextRecipientsForItem = Number(url.searchParams.get("nextRecipientsForItem"));
  if (slug.length === 0 && Number.isFinite(nextRecipientsForItem) && nextRecipientsForItem > 0) {
    const row = await prisma.paymentRequest.findUnique({ where: { id: nextRecipientsForItem } });
    if (!row) return json({ error: "not_found" }, 404);
    const canAct = canActOnStep({ row, userId, userRoleKeys: uctx.roleKeys, userUnitNames: uctx.userUnitNames, roleUnitNames: uctx.roleUnitNames, roleNames: uctx.roleNames });
    if (!canAct) return json({ error: "forbidden" }, 403);
    const step = getCurrentStep(row.historyJson);
    const chain = getWorkflowChainForUnit(row.scope);
    const nextIndex = Number(step?.index ?? -1) + 1;
    const targetRoleKey = chain?.[nextIndex] || null;
    if (!targetRoleKey) return json({ targetRoleKey: null, users: [] });
    const users = await findWorkflowUsersForRole(targetRoleKey, row.createdById);
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
    if (!row) return json({ error: "not_found" }, 404);
    const canAct = canActOnStep({
      row,
      userId,
      userRoleKeys: uctx.roleKeys,
      userUnitNames: uctx.userUnitNames,
      roleUnitNames: uctx.roleUnitNames,
      roleNames: uctx.roleNames,
    });
    const canView = uctx.isMainAdmin || row.createdById === userId || canAct;
    if (!canView) return json({ error: "forbidden" }, 403);

    return json({ item: { ...normalizeOut(row), canAct, canDelete: row.createdById === userId && !["approved", "rejected", "canceled", "cancelled"].includes(row.status) } });
  }

  // GET /api/requests (list)
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
    include: { createdBy: { select: { name: true, username: true, email: true } } },
    orderBy: { id: "desc" },
    take: 500,
  });

  const rowsWithFlags = rows.map((r) => {
    const canAct = canActOnStep({
      row: r,
      userId,
      userRoleKeys: uctx.roleKeys,
      userUnitNames: uctx.userUnitNames,
      roleUnitNames: uctx.roleUnitNames,
      roleNames: uctx.roleNames,
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
      canDelete: x.isMine && !["approved", "rejected", "canceled", "cancelled"].includes(x.row.status),
    })),
  });
}

export async function POST(req, ctx) {
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
    if (!row) return json({ error: "not_found" }, 404);

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

    if (row.createdById === userId && step.roleKey !== ROLE_KEYS.REQUESTER) {
      return json({ error: "self_action_forbidden" }, 403);
    }

    if (!canActOnStep({
      row,
      userId,
      userRoleKeys: uctx.roleKeys,
      userUnitNames: uctx.userUnitNames,
      roleUnitNames: uctx.roleUnitNames,
      roleNames: uctx.roleNames,
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
      const workflowUsers = await findWorkflowUsersForRole(nextRoleKey, row.createdById);
      const nextAssignee = workflowUsers.find((candidate) => Number(candidate.id) === targetAssigneeUserId);
      if (!nextAssignee) return json({ error: targetAssigneeUserId ? "target_assignee_invalid" : "target_assignee_required" }, 400);
      history.push({
        type: "step_set",
        at: new Date().toISOString(),
        unitKind,
        roleKey: nextRoleKey,
        index: nextIndex,
        assignedToUserId: Number(nextAssignee.id),
      });

      const updated = await prisma.paymentRequest.update({
        where: { id },
        data: {
          status: "pending",
          currentAssigneeUserId: Number(nextAssignee.id),
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

  if (!title) return json({ error: "title_required" }, 400);
  if (!data.projectId) return json({ error: "project_required" }, 400);
  if (!data.budgetCode) return json({ error: "budget_code_required" }, 400);
  if (amountBI <= 0n) return json({ error: "amount_must_be_positive" }, 400);

  const targetAssigneeUserId = Number(body?.targetAssigneeUserId ?? body?.target_assignee_user_id);
  const workflowUsers = await findWorkflowUsersForRole(ROLE_KEYS.PROJECT_CONTROL, userId);
  const initialAssignee = workflowUsers.find((candidate) => Number(candidate.id) === targetAssigneeUserId);
  if (!initialAssignee) return json({ error: targetAssigneeUserId ? "target_assignee_invalid" : "target_assignee_required" }, 400);

  const enforcedScope = "projects";
  const generatedSerial = await makePaymentSerial({ dateJalali: data.dateJalali });
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
      currentAssigneeUserId: Number(initialAssignee.id),

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
        },
        {
          type: "step_set",
          at: nowIso,
          unitKind: enforcedScope,
          roleKey: ROLE_KEYS.PROJECT_CONTROL,
          index: 1,
          assignedToUserId: Number(initialAssignee.id),
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
  if (!row) return json({ error: "not_found" }, 404);

  // فقط سازنده (فعلاً)
  if (row.createdById !== userId) return json({ error: "forbidden" }, 403);

  const body = (await readJson(req)) || {};
  const data = pickUpdatable(body);

  if (data.amount == null) delete data.amount;
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
  if (slug.length !== 1) return json({ error: "invalid_path" }, 400);

  const id = Number(slug[0]);
  if (!Number.isFinite(id)) return json({ error: "invalid_id" }, 400);

  const row = await prisma.paymentRequest.findUnique({ where: { id } });
  if (!row) return json({ error: "not_found" }, 404);

  // فقط سازنده
  if (row.createdById !== userId) return json({ error: "forbidden" }, 403);
  if (["approved", "rejected", "canceled", "cancelled"].includes(row.status)) return json({ error: "delete_not_allowed" }, 400);

  await prisma.paymentRequest.delete({ where: { id } });
  return json({ ok: true });
}
