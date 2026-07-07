import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { fallbackUnitsForRoleNames } from "../../../lib/orgStructureFallback";

export const runtime = "nodejs";

const REQUEST_DOC_ID = "supply_request";
const SUPPLY_STEP = {
  REQUESTER: "requester",
  PROJECT_CONTROL: "project_control",
  PROJECT_MANAGER: "project_manager",
};

const json = (data, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

function mapDbError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  if (code === "ECONNREFUSED" || message.includes("can't reach database") || message.includes("econnrefused")) {
    return { error: "database_unreachable", status: 503 };
  }
  if (message.includes("authentication failed")) return { error: "database_auth_failed", status: 503 };
  if (code === "P2003") return { error: "invalid_relation_reference", status: 400 };
  if (code === "P2021" || code === "P2022") return { error: "database_schema_not_ready", status: 503 };
  if (code === "P1001") return { error: "database_unreachable", status: 503 };
  if (code === "P1000") return { error: "database_auth_failed", status: 503 };
  return null;
}

function internalErrorPayload(error) {
  const code = String(error?.code || "").trim();
  const name = String(error?.name || "").trim();
  const message = String(error?.message || "").split("\n").map((line) => line.trim()).filter(Boolean).slice(-1)[0] || "";
  return {
    error: "internal_error",
    ...(code ? { code } : {}),
    ...(name ? { name } : {}),
    ...(message ? { message: message.slice(0, 220) } : {}),
  };
}

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return {};
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

  const sessionId = readCookieValue(cookie, "ipm_session");
  if (sessionId) {
    try {
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: { user: true },
      });
      if (session?.user?.id && (!session.expiresAt || new Date(session.expiresAt).getTime() >= Date.now())) {
        return Number(session.user.id);
      }
    } catch {}

    try {
      const session = await prisma.session.findUnique({
        where: { token: sessionId },
      });
      if (session?.userId && (!session.expiresAt || new Date(session.expiresAt).getTime() >= Date.now())) {
        return Number(session.userId);
      }
    } catch {}

    try {
      const session = await prisma.session.findFirst({
        where: { OR: [{ id: sessionId }, { token: sessionId }] },
      });
      if (session?.userId && (!session.expiresAt || new Date(session.expiresAt).getTime() >= Date.now())) {
        return Number(session.userId);
      }
    } catch {}
  }

  if (process.env.NODE_ENV !== "production") return 1;
  return null;
}

function normalizeDigits(value = "") {
  return String(value ?? "")
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
}

function cleanText(value, max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function toBigIntAmount(value) {
  const raw = normalizeDigits(value).replace(/[^\d]/g, "");
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

function bigintToJson(value) {
  if (typeof value !== "bigint") return value;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : value.toString();
}

function getJalaliYY(value) {
  const fromBody = normalizeDigits(String(value || "")).match(/^(\d{4})/)?.[1];
  if (fromBody) return fromBody.slice(-2);

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

function isMainAdmin(user) {
  const username = String(user?.username || "").trim().toLowerCase();
  const email = String(user?.email || "").trim().toLowerCase();
  return username === "marandi" || email === "marandi@ipecgroup.net";
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
  return { dateJalali: normalizeDigits(dateJalali).replace(/\//g, "/"), time: normalizeDigits(time) };
}

function clientDateTimeInfo(value) {
  const dateJalali = cleanText(value?.dateJalali ?? value?.date ?? "", 20).replaceAll("-", "/");
  const time = cleanText(value?.time ?? "", 10);
  const timezone = cleanText(value?.timezone ?? "", 80);
  if (!dateJalali && !time) return null;
  return {
    ...(dateJalali ? { dateJalali: normalizeDigits(dateJalali) } : {}),
    ...(time ? { time: normalizeDigits(time) } : {}),
    ...(timezone ? { timezone } : {}),
  };
}

function createdHistory(row) {
  const history = Array.isArray(row?.historyJson) ? row.historyJson : [];
  return history.find((entry) => entry?.type === "created") || {};
}

function getCurrentStep(historyJson) {
  const history = Array.isArray(historyJson) ? historyJson : [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (entry?.type === "step_set" && entry.roleKey) return entry;
    if (entry?.type === "step_clear") return null;
  }
  return null;
}

function workflowStatusOf(row) {
  if (row?.status === "approved") return "done";
  if (row?.status === "rejected") return "canceled";
  if (row?.status === "returned") return "in_progress";
  const step = getCurrentStep(row?.historyJson);
  if (step?.roleKey === SUPPLY_STEP.PROJECT_MANAGER) return "final_approval";
  if (step?.roleKey === SUPPLY_STEP.REQUESTER) return "in_progress";
  return "pending";
}

function ccUserIdsOf(row) {
  const history = Array.isArray(row?.historyJson) ? row.historyJson : [];
  const ids = new Set();
  history.forEach((entry) => {
    if (entry?.type !== "cc_added") return;
    normalizeIdList(entry.userIds).forEach((id) => ids.add(String(id)));
  });
  return Array.from(ids);
}

function latestWorkflowMeta(row) {
  const history = Array.isArray(row?.historyJson) ? row.historyJson : [];
  const meta = {};
  history.forEach((entry) => {
    if (entry?.type !== "workflow_meta") return;
    if (entry.finalAmount !== undefined) meta.finalAmount = entry.finalAmount;
    if (entry.actionText !== undefined) meta.actionText = entry.actionText;
    if (entry.deadlineDate !== undefined) meta.deadlineDate = entry.deadlineDate;
  });
  return meta;
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

async function creatorContext(userId) {
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: { id: true, name: true, username: true, email: true, department: true },
  });
  let userUnits = [];
  let userRoles = [];
  try {
    [userUnits, userRoles] = await Promise.all([
      prisma.userUnit.findMany({
        where: { userId: Number(userId) },
        include: { unit: true },
        orderBy: { unitId: "asc" },
      }),
      prisma.userRoleMap.findMany({
        where: { userId: Number(userId) },
        include: { role: true },
        orderBy: { roleId: "asc" },
      }),
    ]);
  } catch (err) {
    console.warn("supply_requests_creator_context_assignment_warn", err?.message || err);
  }
  if (user?.role && user.role !== "user") {
    const exists = userRoles.some((row) => String(row?.role?.name || "") === String(user.role));
    if (!exists) userRoles.push({ roleId: null, role: { name: user.role } });
  }
  const roleIds = userRoles.map((row) => Number(row.roleId)).filter(Boolean);
  const roleNamesRaw = Array.from(new Set(userRoles.map((row) => row.role?.name).filter(Boolean)));
  let unitRoleRows = [];
  if (roleIds.length) {
    try {
      unitRoleRows = await prisma.unitRoleMap.findMany({
          where: { roleId: { in: roleIds } },
          include: { unit: true, role: true },
          orderBy: [{ unitId: "asc" }, { roleId: "asc" }],
        });
    } catch (err) {
      console.warn("supply_requests_creator_context_unit_role_warn", err?.message || err);
    }
  }
  if (roleNamesRaw.length) {
    try {
      const byNameRows = await prisma.unitRoleMap.findMany({
        where: { role: { name: { in: roleNamesRaw } } },
        include: { unit: true, role: true },
        orderBy: [{ unitId: "asc" }, { roleId: "asc" }],
      });
      const seen = new Set(unitRoleRows.map((row) => `${row.unitId}:${row.roleId}`));
      byNameRows.forEach((row) => {
        const key = `${row.unitId}:${row.roleId}`;
        if (!seen.has(key)) unitRoleRows.push(row);
      });
    } catch (err) {
      console.warn("supply_requests_creator_context_unit_role_name_warn", err?.message || err);
    }
  }
  const unitNames = Array.from(
    new Set([
      ...userUnits.map((row) => row.unit?.name).filter(Boolean),
      ...unitRoleRows.map((row) => row.unit?.name).filter(Boolean),
      ...fallbackUnitsForRoleNames(roleNamesRaw),
      ...inferredUnitNamesFromRoles(roleNamesRaw),
    ])
  );
  const roleNames = roleNamesRaw;
  const userName = user?.username || user?.name || user?.email || `کاربر #${userId}`;
  const unitName = unitNames.join("، ") || "نامشخص";
  const roleName = roleNames.join("، ") || "نامشخص";
  return { user, userName, unitName, roleName, unitNames, roleNames };
}

async function userRoleAndUnitContext(userId) {
  const base = await creatorContext(userId);
  return {
    ...base,
    unitNames: Array.isArray(base.unitNames) ? base.unitNames : [],
    roleNames: Array.isArray(base.roleNames) ? base.roleNames : [],
  };
}

function includesAny(values, patterns) {
  const text = (Array.isArray(values) ? values : []).map((value) => normalizeFaText(value)).join(" ");
  return patterns.some((pattern) => text.includes(normalizeFaText(pattern)));
}

function isProjectControlContext(ctx) {
  return includesAny([...(ctx?.unitNames || []), ...(ctx?.roleNames || [])], ["برنامه ریزی", "برنامه‌ریزی", "کنترل پروژه"]);
}

function isProjectManagerContext(ctx) {
  return includesAny(ctx?.roleNames || [], ["مدیر پروژه", "مدیریت پروژه", "project manager"]);
}

async function findWorkflowUsers(kind, excludeUserId = null) {
  let users = [];
  try {
    users = await prisma.user.findMany({
      include: {
        units: { include: { unit: true } },
        roles: { include: { role: true } },
      },
      orderBy: { id: "asc" },
      take: 500,
    });
  } catch (err) {
    console.warn("supply_requests_find_workflow_users_include_warn", err?.message || err);
    users = await prisma.user.findMany({
      orderBy: { id: "asc" },
      take: 500,
    });
  }

  const unitRoleRows = prisma.unitRoleMap
    ? await prisma.unitRoleMap.findMany({
        include: { unit: true, role: true },
        orderBy: [{ unitId: "asc" }, { roleId: "asc" }],
      }).catch(() => [])
    : [];
  const unitNamesByRoleId = new Map();
  unitRoleRows.forEach((row) => {
    const roleId = Number(row.roleId);
    if (!roleId || !row.unit?.name) return;
    const list = unitNamesByRoleId.get(roleId) || [];
    list.push(row.unit.name);
    unitNamesByRoleId.set(roleId, list);
  });
  const candidates = users
    .map((user) => {
      const roleIds = Array.isArray(user.roles) ? user.roles.map((row) => Number(row.roleId)).filter(Boolean) : [];
      const roleNames = [
        ...(Array.isArray(user.roles) ? user.roles.map((row) => row.role?.name).filter(Boolean) : []),
        user.role && user.role !== "user" ? user.role : "",
      ].filter(Boolean);
      const unitNames = [
        ...(Array.isArray(user.units) ? user.units.map((row) => row.unit?.name).filter(Boolean) : []),
        ...roleIds.flatMap((roleId) => unitNamesByRoleId.get(roleId) || []),
        ...fallbackUnitsForRoleNames(roleNames),
        ...inferredUnitNamesFromRoles(roleNames),
      ];
      return { user, roleNames, unitNames };
    })
    .filter((ctx) => (kind === SUPPLY_STEP.PROJECT_CONTROL ? isProjectControlContext(ctx) : isProjectManagerContext(ctx)));

  return candidates
    .filter((ctx) => !excludeUserId || Number(ctx.user.id) !== Number(excludeUserId))
    .map((ctx) => ctx.user);
}

function serializeWorkflowUsers(users = []) {
  return (Array.isArray(users) ? users : []).map((user) => ({
    id: user.id,
    name: user.name || user.username || user.email || `کاربر #${user.id}`,
    username: user.username || null,
    email: user.email || null,
    department: user.department || null,
  }));
}

async function requireWorkflowAssignee(kind, selectedUserId, excludeUserId, errorCode) {
  const users = await findWorkflowUsers(kind, excludeUserId);
  if (!users.length) return { error: errorCode };
  const selected = selectedUserId ? users.find((user) => Number(user.id) === Number(selectedUserId)) : null;
  if (!selected) return { error: selectedUserId ? "target_assignee_invalid" : "target_assignee_required" };
  return { user: selected, users };
}

function nextRoleKeyForCreatorContext(ctx) {
  if (isProjectManagerContext(ctx)) return null;
  if (isProjectControlContext(ctx)) return SUPPLY_STEP.PROJECT_MANAGER;
  return SUPPLY_STEP.PROJECT_CONTROL;
}

async function nextApproveRoleKeyForRow(row, step) {
  if (!step) return null;
  if (step.roleKey === SUPPLY_STEP.REQUESTER) {
    const creatorCtx = await userRoleAndUnitContext(row.createdById);
    return nextRoleKeyForCreatorContext(creatorCtx);
  }
  if (step.roleKey === SUPPLY_STEP.PROJECT_CONTROL) return SUPPLY_STEP.PROJECT_MANAGER;
  return null;
}

function canActOnSupplyStep({ row, userId, userCtx, mainAdmin }) {
  const step = getCurrentStep(row?.historyJson);
  if (!step) return false;
  if (mainAdmin) return true;
  if (Number(row.currentAssigneeUserId) === Number(userId)) return true;
  if (!row.currentAssigneeUserId && step.roleKey === SUPPLY_STEP.REQUESTER) return Number(row.createdById) === Number(userId);
  return false;
}

function serializeItem(row) {
  if (!row) return null;
  const created = createdHistory(row);
  const step = getCurrentStep(row.historyJson);
  const canAct = row.canAct === true;
  return {
    id: row.id,
    serial: row.serial,
    dateJalali: row.dateJalali,
    dateFa: row.dateJalali,
    projectId: row.projectId,
    projectCode: row.project?.code || null,
    projectName: row.project?.name || null,
    budgetCode: row.budgetCode,
    title: row.title,
    description: row.description,
    needDateJalali: row.docDateJalali,
    amount: bigintToJson(row.amount),
    attachments: row.attachments,
    relatedLetterIds: normalizeIdList(created.relatedLetterIds),
    status: row.status,
    workflowStatus: workflowStatusOf(row),
    historyJson: row.historyJson,
    currentStepRoleKey: step?.roleKey || null,
    currentStepIndex: typeof step?.index === "number" ? step.index : null,
    currentAssigneeUserId: row.currentAssigneeUserId,
    currentAssigneeName: row.currentAssigneeUser?.name || row.currentAssigneeUser?.username || row.currentAssigneeUser?.email || null,
    ccUserIds: ccUserIdsOf(row),
    workflowMeta: latestWorkflowMeta(row),
    canAct,
    canDelete: row.canDelete === true,
    createdById: row.createdById,
    createdByName: row.createdBy?.name || row.createdBy?.username || row.createdBy?.email || null,
    registrationInfo: created.registrationInfo || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function resolveProject(projectId) {
  if (!projectId) return null;
  return prisma.project.findFirst({
    where: { id: projectId, isActive: true },
    select: { id: true, code: true, name: true },
  });
}

async function makeSerial({ dateJalali }) {
  const yy = getJalaliYY(dateJalali);
  const prefix = `${yy}/`;
  const rows = await prisma.paymentRequest.findMany({
    where: {
      docId: REQUEST_DOC_ID,
      serial: { startsWith: prefix },
    },
    select: { serial: true },
    take: 1000,
  });

  let maxSeq = 0;
  const re = new RegExp(`^${yy}/(?:\\d{3}/)?(\\d{3})$`);
  for (const row of rows) {
    const m = String(row?.serial || "").match(re);
    if (m) maxSeq = Math.max(maxSeq, Number(m[1]) || 0);
  }

  return `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
}

async function userContext(userId) {
  const user = await prisma.user.findUnique({ where: { id: Number(userId) } });
  return { user, mainAdmin: isMainAdmin(user) };
}

export async function GET(req) {
  try {
    const userId = await getUserId(req);
    if (!userId) return json({ error: "unauthorized" }, 401);

    const url = new URL(req.url);
    if (url.searchParams.get("nextRecipientsForCreate") === "1") {
      const creatorCtx = await userRoleAndUnitContext(userId);
      const targetRoleKey = nextRoleKeyForCreatorContext(creatorCtx);
      if (!targetRoleKey) return json({ targetRoleKey: null, users: [] });
      const users = await findWorkflowUsers(targetRoleKey, userId);
      return json({ targetRoleKey, users: serializeWorkflowUsers(users) });
    }

    const nextRecipientsForItem = toPositiveInt(url.searchParams.get("nextRecipientsForItem"));
    if (nextRecipientsForItem) {
      const row = await prisma.paymentRequest.findFirst({
        where: { id: nextRecipientsForItem, docId: REQUEST_DOC_ID },
      });
      if (!row) return json({ error: "not_found" }, 404);
      const { mainAdmin } = await userContext(userId);
      const userCtx = await userRoleAndUnitContext(userId);
      if (!canActOnSupplyStep({ row, userId, userCtx, mainAdmin })) return json({ error: "forbidden" }, 403);
      const step = getCurrentStep(row.historyJson);
      const targetRoleKey = await nextApproveRoleKeyForRow(row, step);
      if (!targetRoleKey) return json({ targetRoleKey: null, users: [] });
      const users = await findWorkflowUsers(targetRoleKey, row.createdById);
      return json({ targetRoleKey, users: serializeWorkflowUsers(users) });
    }

    if (url.searchParams.get("users") === "1") {
      const users = await prisma.user.findMany({
        select: { id: true, name: true, username: true, email: true, department: true },
        orderBy: { id: "asc" },
        take: 1000,
      });
      return json({ users });
    }

    const { mainAdmin } = await userContext(userId);
    const where = {
      docId: REQUEST_DOC_ID,
    };

    const rows = await prisma.paymentRequest.findMany({
      where,
      include: {
        createdBy: { select: { name: true, username: true, email: true } },
        currentAssigneeUser: { select: { name: true, username: true, email: true } },
      },
      orderBy: { id: "desc" },
      take: 500,
    });

    const projectIds = Array.from(new Set(rows.map((row) => row.projectId).filter(Boolean)));
    const projects = projectIds.length
      ? await prisma.project.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, code: true, name: true },
        })
      : [];
    const projectById = new Map(projects.map((project) => [Number(project.id), project]));

    const userCtx = await userRoleAndUnitContext(userId);
    const cartableOnly = url.searchParams.get("cartable") === "1";
    const visibleRows = mainAdmin
      ? rows
      : rows.filter((row) => {
          const canAct = canActOnSupplyStep({ row, userId, userCtx, mainAdmin });
          if (cartableOnly) return canAct && Number(row.currentAssigneeUserId) === Number(userId);
          return (
            Number(row.createdById) === Number(userId) ||
            ccUserIdsOf(row).includes(String(userId))
          );
        });
    const finalRows = cartableOnly
      ? visibleRows.filter((row) => {
          const step = getCurrentStep(row.historyJson);
          return !!step && (mainAdmin || Number(row.currentAssigneeUserId) === Number(userId));
        })
      : visibleRows;
    return json({
      items: finalRows.map((row) => serializeItem({
        ...row,
        project: projectById.get(Number(row.projectId)) || null,
        canAct: canActOnSupplyStep({ row, userId, userCtx, mainAdmin }),
        canDelete: Number(row.createdById) === Number(userId),
      })),
    });
  } catch (e) {
    console.error("supply_requests_get_error", e);
    const mapped = mapDbError(e);
    if (mapped) return json({ error: mapped.error }, mapped.status);
    return json(internalErrorPayload(e), 500);
  }
}

export async function POST(req) {
  try {
    const userId = await getUserId(req);
    if (!userId) return json({ error: "unauthorized" }, 401);

    const body = await readJson(req);
    const workflowAction = cleanText(body.workflowAction ?? body.action, 40);
    if (workflowAction) {
      const id = toPositiveInt(body.id);
      const note = cleanText(body.note, 2000);
      const nextBudgetCode = cleanText(body.budgetCode ?? body.budget_code, 80);
      const finalAmount = body.finalAmount !== undefined || body.final_amount !== undefined ? toBigIntAmount(body.finalAmount ?? body.final_amount) : null;
      const actionText = cleanText(body.actionText ?? body.action_text, 500);
      const deadlineDate = cleanText(body.deadlineDate ?? body.deadline_date, 20).replaceAll("-", "/");
      const ccUserIds = normalizeIdList(body.ccUserIds ?? body.cc_user_ids).map(Number).filter((n) => Number.isFinite(n) && n > 0);
      const targetAssigneeUserId = toPositiveInt(body.targetAssigneeUserId ?? body.target_assignee_user_id ?? body.assigneeUserId ?? body.assignee_user_id);
      if (!id) return json({ error: "invalid_id" }, 400);
      if (!["approve", "return", "reject"].includes(workflowAction)) return json({ error: "invalid_action" }, 400);

      const row = await prisma.paymentRequest.findFirst({
        where: { id, docId: REQUEST_DOC_ID },
        include: {
          createdBy: { select: { name: true, username: true, email: true } },
          currentAssigneeUser: { select: { name: true, username: true, email: true } },
        },
      });
      if (!row) return json({ error: "not_found" }, 404);

      const { mainAdmin } = await userContext(userId);
      const userCtx = await userRoleAndUnitContext(userId);
      if (!canActOnSupplyStep({ row, userId, userCtx, mainAdmin })) return json({ error: "forbidden" }, 403);

      const history = Array.isArray(row.historyJson) ? row.historyJson : [];
      const step = getCurrentStep(history);
      if (!step) return json({ error: "no_active_step" }, 400);

      const nowIso = new Date().toISOString();
      const currentIndex = typeof step.index === "number" ? step.index : 0;
      const scalarUpdates = {};
      if (step.roleKey === SUPPLY_STEP.PROJECT_CONTROL && nextBudgetCode) scalarUpdates.budgetCode = nextBudgetCode;
      if (step.roleKey === SUPPLY_STEP.PROJECT_MANAGER && finalAmount !== null && finalAmount > 0n) scalarUpdates.amount = finalAmount;
      if (step.roleKey === SUPPLY_STEP.PROJECT_MANAGER && (actionText || deadlineDate || finalAmount !== null)) {
        history.push({
          byUserId: Number(userId),
          type: "workflow_meta",
          at: nowIso,
          roleKey: step.roleKey,
          ...(finalAmount !== null && finalAmount > 0n ? { finalAmount: bigintToJson(finalAmount) } : {}),
          ...(actionText ? { actionText } : {}),
          ...(deadlineDate ? { deadlineDate } : {}),
        });
      }
      if (step.roleKey === SUPPLY_STEP.PROJECT_MANAGER && ccUserIds.length) {
        history.push({
          byUserId: Number(userId),
          type: "cc_added",
          at: nowIso,
          roleKey: step.roleKey,
          userIds: Array.from(new Set(ccUserIds.map(String))),
        });
      }
      history.push({
        byUserId: Number(userId),
        type: workflowAction === "approve" ? "approved" : workflowAction === "return" ? "returned" : "rejected",
        status: workflowAction === "approve" ? "approved" : workflowAction === "return" ? "returned" : "rejected",
        note,
        at: nowIso,
        roleKey: step.roleKey,
        index: currentIndex,
      });

      let data = { historyJson: history };
      if (workflowAction === "return") {
        if (![SUPPLY_STEP.PROJECT_CONTROL, SUPPLY_STEP.PROJECT_MANAGER].includes(step.roleKey)) return json({ error: "return_not_allowed_for_step" }, 403);
        history.push({
          type: "step_set",
          at: nowIso,
          roleKey: SUPPLY_STEP.REQUESTER,
          index: 0,
          assignedToUserId: Number(row.createdById),
        });
        data = { ...scalarUpdates, status: "returned", currentAssigneeUserId: Number(row.createdById), historyJson: history };
      } else if (workflowAction === "reject") {
        if (step.roleKey !== SUPPLY_STEP.PROJECT_MANAGER) return json({ error: "reject_not_allowed_for_step" }, 403);
        history.push({ type: "step_clear", at: nowIso });
        data = { ...scalarUpdates, status: "rejected", currentAssigneeUserId: null, historyJson: history };
      } else if (step.roleKey === SUPPLY_STEP.REQUESTER) {
        const nextRoleKey = await nextApproveRoleKeyForRow(row, step);
        if (!nextRoleKey) {
          history.push({ type: "step_clear", at: nowIso });
          data = { ...scalarUpdates, status: "approved", currentAssigneeUserId: Number(row.createdById), historyJson: history };
        } else {
          const resolved = await requireWorkflowAssignee(
            nextRoleKey,
            targetAssigneeUserId,
            row.createdById,
            nextRoleKey === SUPPLY_STEP.PROJECT_CONTROL ? "project_control_user_not_found" : "project_manager_user_not_found"
          );
          if (resolved.error) return json({ error: resolved.error }, 400);
          history.push({
            type: "step_set",
            at: nowIso,
            roleKey: nextRoleKey,
            index: nextRoleKey === SUPPLY_STEP.PROJECT_CONTROL ? 1 : 2,
            assignedToUserId: Number(resolved.user.id),
          });
          data = { ...scalarUpdates, status: "pending", currentAssigneeUserId: Number(resolved.user.id), historyJson: history };
        }
      } else if (step.roleKey === SUPPLY_STEP.PROJECT_CONTROL) {
        const resolved = await requireWorkflowAssignee(SUPPLY_STEP.PROJECT_MANAGER, targetAssigneeUserId, row.createdById, "project_manager_user_not_found");
        if (resolved.error) return json({ error: resolved.error }, 400);
        history.push({
          type: "step_set",
          at: nowIso,
          roleKey: SUPPLY_STEP.PROJECT_MANAGER,
          index: 2,
          assignedToUserId: Number(resolved.user.id),
        });
        data = { ...scalarUpdates, status: "pending", currentAssigneeUserId: Number(resolved.user.id), historyJson: history };
      } else if (step.roleKey === SUPPLY_STEP.PROJECT_MANAGER) {
        history.push({ type: "step_clear", at: nowIso });
        data = { ...scalarUpdates, status: "approved", currentAssigneeUserId: Number(row.createdById), historyJson: history };
      } else {
        return json({ error: "invalid_step" }, 400);
      }

      const updated = await prisma.paymentRequest.update({
        where: { id },
        data,
        include: {
          createdBy: { select: { name: true, username: true, email: true } },
          currentAssigneeUser: { select: { name: true, username: true, email: true } },
        },
      });
      return json({ ok: true, item: serializeItem({
        ...updated,
        canAct: canActOnSupplyStep({ row: updated, userId, userCtx, mainAdmin }),
        canDelete: Number(updated.createdById) === Number(userId),
      }) });
    }

    const projectId = toPositiveInt(body.projectId ?? body.project_id);
    const project = await resolveProject(projectId);
    if (!project) return json({ error: "active_project_not_found" }, 404);

    const title = cleanText(body.title, 255);
    const budgetCode = cleanText(body.budgetCode ?? body.budget_code, 80);
    const dateJalali = cleanText(body.dateJalali ?? body.dateFa ?? body.date_jalali, 20);
    const needDateJalali = cleanText(body.needDateJalali ?? body.need_date_jalali, 20);
    const description = cleanText(body.description, 2000);
    const amount = toBigIntAmount(body.amount);
    const targetAssigneeUserId = toPositiveInt(body.targetAssigneeUserId ?? body.target_assignee_user_id ?? body.assigneeUserId ?? body.assignee_user_id);

    if (!title) return json({ error: "title_required" }, 400);
    if (!budgetCode) return json({ error: "budget_code_required" }, 400);
    if (amount <= 0n) return json({ error: "amount_must_be_positive" }, 400);

    const creatorCtxForRouting = await userRoleAndUnitContext(userId);
    const initialTargetRoleKey = nextRoleKeyForCreatorContext(creatorCtxForRouting);
    const initialAssignee = initialTargetRoleKey
      ? await requireWorkflowAssignee(
          initialTargetRoleKey,
          targetAssigneeUserId,
          userId,
          initialTargetRoleKey === SUPPLY_STEP.PROJECT_CONTROL ? "project_control_user_not_found" : "project_manager_user_not_found"
        )
      : { user: null };
    if (initialAssignee.error) return json({ error: initialAssignee.error }, 400);

    const serial = await makeSerial({ dateJalali });
    if (!serial) return json({ error: "serial_generation_failed" }, 400);

    const now = new Date();
    const nowIso = now.toISOString();
    const { userName, unitName, roleName } = await creatorContext(userId);
    const clientInfo = clientDateTimeInfo(body.clientRegistrationInfo);
    const registrationInfo = {
      ...formatRegistrationDateTime(now),
      ...(clientInfo || {}),
      userId: Number(userId),
      userName,
      unitName,
      roleName,
    };
    const relatedLetterIds = normalizeIdList(body.relatedLetterIds ?? body.related_letter_ids);
    const historyJson = [
      {
        byUserId: Number(userId),
        type: "created",
        status: initialTargetRoleKey ? "pending" : "approved",
        note: "",
        at: nowIso,
        requestKind: REQUEST_DOC_ID,
        registrationInfo,
        relatedLetterIds,
      },
    ];
    if (initialTargetRoleKey) {
      historyJson.push({
        type: "step_set",
        at: nowIso,
        roleKey: initialTargetRoleKey,
        index: initialTargetRoleKey === SUPPLY_STEP.PROJECT_CONTROL ? 1 : 2,
        assignedToUserId: Number(initialAssignee.user.id),
      });
    } else {
      historyJson.push({ type: "step_clear", at: nowIso });
    }
    const created = await prisma.paymentRequest.create({
      data: {
        serial,
        dateJalali: dateJalali || null,
        scope: "projects",
        title,
        description: description || null,
        amount,
        cashAmount: null,
        cashDateJalali: null,
        creditAmount: null,
        creditPay: null,
        beneficiaryName: null,
        bankInfo: null,
        docId: REQUEST_DOC_ID,
        docOther: "درخواست تامین",
        docNumber: null,
        docDateJalali: needDateJalali || null,
        currencyTypeId: null,
        currencySourceId: null,
        projectId,
        budgetCode,
        attachments: Array.isArray(body.attachments) ? body.attachments : [],
        createdById: Number(userId),
        currentAssigneeUserId: initialTargetRoleKey ? Number(initialAssignee.user.id) : Number(userId),
        status: initialTargetRoleKey ? "pending" : "approved",
        historyJson,
      },
      include: {
        createdBy: { select: { name: true, username: true, email: true } },
        currentAssigneeUser: { select: { name: true, username: true, email: true } },
      },
    });

    return json({ ok: true, item: serializeItem({ ...created, project, canAct: false, canDelete: true }) }, 201);
  } catch (e) {
    console.error("supply_requests_post_error", e);
    const mapped = mapDbError(e);
    if (mapped) return json({ error: mapped.error }, mapped.status);
    return json(internalErrorPayload(e), 500);
  }
}

export async function DELETE(req) {
  try {
    const userId = await getUserId(req);
    if (!userId) return json({ error: "unauthorized" }, 401);

    const url = new URL(req.url);
    const id = toPositiveInt(url.searchParams.get("id"));
    if (!id) return json({ error: "invalid_id" }, 400);

    const row = await prisma.paymentRequest.findFirst({
      where: { id, docId: REQUEST_DOC_ID },
      select: { id: true, createdById: true },
    });
    if (!row) return json({ error: "not_found" }, 404);
    if (Number(row.createdById) !== Number(userId)) return json({ error: "forbidden" }, 403);

    await prisma.paymentRequest.delete({ where: { id } });
    return json({ ok: true });
  } catch (e) {
    console.error("supply_requests_delete_error", e);
    const mapped = mapDbError(e);
    if (mapped) return json({ error: mapped.error }, mapped.status);
    return json(internalErrorPayload(e), 500);
  }
}
