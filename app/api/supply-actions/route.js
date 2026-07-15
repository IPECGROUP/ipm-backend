import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUEST_DOC_ID = "supply_request";
const COMMERCIAL_STEP = "commercial";
const ACTION_TYPE = "supply_action";
const ACTION_STATUSES = new Set(["in_progress", "done", "canceled"]);
let storageReady = false;

const json = (data, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

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

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
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

function normalizeDate(value) {
  const raw = normalizeDigits(value).replace(/-/g, "/").trim();
  const m = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return "";
  return `${m[1]}/${String(m[2]).padStart(2, "0")}/${String(m[3]).padStart(2, "0")}`;
}

function normalizeTime(value) {
  const raw = normalizeDigits(value).trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeFiles(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((file) => file && typeof file === "object")
    .map((file) => ({
      id: file.id ?? file.serverId ?? file.fileId ?? null,
      serverId: file.serverId ?? file.id ?? file.fileId ?? null,
      name: cleanText(file.name ?? file.originalName ?? file.original_name ?? "فایل", 255),
      url: cleanText(file.url ?? "", 1000),
      size: Number(file.size || 0) || 0,
      type: cleanText(file.type ?? file.mimeType ?? file.mime ?? "", 120),
    }));
}

function historyOf(row) {
  return Array.isArray(row?.historyJson) ? row.historyJson : [];
}

async function ensureSupplyActionStorage() {
  if (storageReady) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "supply_action_entries" (
      "id" TEXT PRIMARY KEY,
      "request_id" INTEGER NOT NULL,
      "action_date" VARCHAR(20),
      "description" TEXT,
      "status" VARCHAR(30) NOT NULL DEFAULT 'in_progress',
      "files" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "created_by" INTEGER,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE "supply_action_entries" ADD COLUMN IF NOT EXISTS "action_time" VARCHAR(8)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "supply_action_entries_request_id_idx" ON "supply_action_entries" ("request_id")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "supply_action_entries_created_by_idx" ON "supply_action_entries" ("created_by")`);
  storageReady = true;
}

function getCurrentStep(history) {
  let current = null;
  for (const entry of Array.isArray(history) ? history : []) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.type === "step_set" && entry.roleKey) current = entry;
    if (entry.type === "step_clear") current = null;
  }
  return current;
}

function supplyActionsOf(history) {
  return (Array.isArray(history) ? history : [])
    .filter((entry) => entry && entry.type === ACTION_TYPE && entry.actionId)
    .map((entry) => ({
      id: String(entry.actionId),
      date: entry.date || "",
      time: entry.time || "",
      description: entry.description || "",
      status: ACTION_STATUSES.has(entry.lastStatus) ? entry.lastStatus : "in_progress",
      files: normalizeFiles(entry.files),
      createdAt: entry.createdAt || entry.at || "",
      updatedAt: entry.updatedAt || entry.at || "",
      byUserId: entry.byUserId || null,
    }))
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

function serializeStoredAction(row) {
  return {
    id: String(row.id),
    date: row.action_date || "",
    time: row.action_time || "",
    description: row.description || "",
    status: ACTION_STATUSES.has(row.status) ? row.status : "in_progress",
    files: normalizeFiles(row.files),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    byUserId: row.created_by || null,
  };
}

async function actionsByRequestIds(ids, db = prisma) {
  const cleanIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isFinite(n) && n > 0)));
  if (!cleanIds.length) return new Map();
  const rows = await db.$queryRawUnsafe(
    `SELECT "id", "request_id", "action_date", "action_time", "description", "status", "files", "created_by", "created_at", "updated_at"
     FROM "supply_action_entries"
     WHERE "request_id" = ANY($1::int[])
     ORDER BY "created_at" ASC, "id" ASC`,
    cleanIds
  );
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const requestId = Number(row.request_id);
    if (!map.has(requestId)) map.set(requestId, []);
    map.get(requestId).push(serializeStoredAction(row));
  }
  return map;
}

function latestActionStatus(actions, fallbackStatus) {
  const last = actions[actions.length - 1];
  if (last?.status) return last.status;
  if (fallbackStatus === "approved") return "done";
  if (fallbackStatus === "rejected") return "canceled";
  return "in_progress";
}

function workflowStatusOf(row, actions) {
  const actionStatus = latestActionStatus(actions, row?.status);
  if (actionStatus === "done" || actionStatus === "canceled") return actionStatus;
  const step = getCurrentStep(historyOf(row));
  if (step?.roleKey === COMMERCIAL_STEP) return "in_progress";
  if (row?.status === "approved") return "done";
  if (row?.status === "rejected") return "canceled";
  return "in_progress";
}

function projectLabel(row) {
  const code = row?.project?.code || "";
  const name = row?.project?.name || "";
  if (code && name) return `${code} - ${name}`;
  return name || code || "";
}

function serialize(row) {
  const storedActions = Array.isArray(row?.supplyActions) ? row.supplyActions : [];
  const actions = storedActions.length ? storedActions : supplyActionsOf(historyOf(row));
  return {
    id: row.id,
    serial: row.serial,
    dateJalali: row.dateJalali,
    title: row.title,
    projectId: row.projectId,
    projectCode: row.project?.code || null,
    projectName: row.project?.name || null,
    projectLabel: projectLabel(row),
    status: row.status,
    workflowStatus: workflowStatusOf(row, actions),
    currentAssigneeUserId: row.currentAssigneeUserId,
    actions,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function attachProjects(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const projectIds = Array.from(new Set(list.map((row) => row?.projectId).filter(Boolean).map(Number)));
  const projects = projectIds.length
    ? await prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, code: true, name: true },
      })
    : [];
  const byId = new Map(projects.map((project) => [Number(project.id), project]));
  return list.map((row) => ({ ...row, project: byId.get(Number(row.projectId)) || null }));
}

function canUseSupplyAction(row, userId) {
  const history = historyOf(row);
  const currentStep = getCurrentStep(history);
  const storedActions = Array.isArray(row?.supplyActions) ? row.supplyActions : [];
  const hasOwnAction = (storedActions.length ? storedActions : supplyActionsOf(history)).some((action) => Number(action.byUserId) === Number(userId));
  return (
    row?.docId === REQUEST_DOC_ID &&
    (Number(row.currentAssigneeUserId) === Number(userId) || hasOwnAction) &&
    (currentStep?.roleKey === COMMERCIAL_STEP || hasOwnAction || row.status === "approved" || row.status === "rejected")
  );
}

function statusData(nextStatus, row, history, userId) {
  if (nextStatus === "done") {
    history.push({ type: "step_clear", at: new Date().toISOString(), reason: "supply_action_done" });
    return { status: "approved", currentAssigneeUserId: Number(row.currentAssigneeUserId) || null };
  }
  if (nextStatus === "canceled") {
    history.push({ type: "step_clear", at: new Date().toISOString(), reason: "supply_action_canceled" });
    return { status: "rejected", currentAssigneeUserId: Number(row.currentAssigneeUserId) || null };
  }
  const currentStep = getCurrentStep(history);
  const assigneeUserId = Number(row.currentAssigneeUserId) || Number(userId);
  if (!currentStep || currentStep.roleKey !== COMMERCIAL_STEP) {
    history.push({
      type: "step_set",
      at: new Date().toISOString(),
      roleKey: COMMERCIAL_STEP,
      index: 3,
      assignedToUserId: assigneeUserId,
    });
  }
  return { status: "pending", currentAssigneeUserId: assigneeUserId || null };
}

export async function GET(req) {
  try {
    await ensureSupplyActionStorage();
    const userId = await getUserId(req);
    if (!userId) return json({ error: "unauthorized" }, 401);

    const url = new URL(req.url);
    const requestId = toPositiveInt(url.searchParams.get("requestId") ?? url.searchParams.get("request_id"));
    const rows = await prisma.paymentRequest.findMany({
      where: {
        docId: REQUEST_DOC_ID,
        ...(requestId ? { id: requestId } : {}),
        OR: [
          { currentAssigneeUserId: Number(userId) },
          { status: { in: ["approved", "rejected"] } },
        ],
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: requestId ? 1 : 300,
    });

    const actionsMap = await actionsByRequestIds(rows.map((row) => row.id));
    const rowsWithProjects = (await attachProjects(rows)).map((row) => ({
      ...row,
      supplyActions: actionsMap.get(Number(row.id)) || [],
    }));
    const items = rowsWithProjects.filter((row) => canUseSupplyAction(row, userId)).map(serialize);
    return json({ ok: true, items });
  } catch (error) {
    console.error("supply_actions_get_error", error);
    return json({ error: "internal_error" }, 500);
  }
}

export async function POST(req) {
  try {
    await ensureSupplyActionStorage();
    const userId = await getUserId(req);
    if (!userId) return json({ error: "unauthorized" }, 401);
    const body = await readJson(req);
    const requestId = toPositiveInt(body.requestId ?? body.request_id ?? body.id);
    const mode = cleanText(body.mode || "upsert", 20);
    const actionId = cleanText(body.actionId ?? body.action_id, 80) || `sa_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    if (!requestId) return json({ error: "invalid_request_id" }, 400);

    const row = await prisma.paymentRequest.findFirst({
      where: { id: requestId, docId: REQUEST_DOC_ID },
    });
    if (!row) return json({ error: "not_found" }, 404);
    if (!canUseSupplyAction(row, userId)) return json({ error: "forbidden" }, 403);

    const history = historyOf(row).slice();
    if (mode === "delete") {
      const { updated, remainingActions } = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`DELETE FROM "supply_action_entries" WHERE "id" = $1 AND "request_id" = $2`, actionId, requestId);
        const remainingMap = await actionsByRequestIds([requestId], tx);
        const nextActions = remainingMap.get(Number(requestId)) || [];
        const nextHistory = history.slice();
        const nextStatus = latestActionStatus(nextActions, "pending");
        const workflowData = statusData(nextStatus, row, nextHistory, userId);
        const nextRequest = await tx.paymentRequest.update({
          where: { id: requestId },
          data: { ...workflowData, historyJson: nextHistory },
        });
        return { updated: nextRequest, remainingActions: nextActions };
      });
      const [updatedWithProject] = await attachProjects([updated]);
      return json({ ok: true, item: serialize({ ...updatedWithProject, supplyActions: remainingActions }) });
    }

    // وضعیت فقط هنگام ثبت اولیه تعیین می‌شود؛ ویرایش اقدام قبلی نباید
    // بتواند درخواست را ناگهان «انجام شد» یا «لغو شد» کند.
    const updated = await prisma.$transaction(async (tx) => {
      const existingRows = await tx.$queryRawUnsafe(
        `SELECT "request_id", "status" FROM "supply_action_entries" WHERE "id" = $1 LIMIT 1`,
        actionId
      );
      const existing = existingRows?.[0] || null;
      if (existing && Number(existing.request_id) !== Number(requestId)) throw new Error("action_request_mismatch");
      const existingStatus = ACTION_STATUSES.has(existing?.status) ? existing.status : null;
      const nextStatus = existingStatus || (ACTION_STATUSES.has(body.status) ? body.status : "in_progress");

      await tx.$executeRawUnsafe(
        `INSERT INTO "supply_action_entries" ("id", "request_id", "action_date", "action_time", "description", "status", "files", "created_by", "created_at", "updated_at")
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, now(), now())
         ON CONFLICT ("id") DO UPDATE SET
           "action_date" = EXCLUDED."action_date",
           "action_time" = EXCLUDED."action_time",
           "description" = EXCLUDED."description",
           "status" = EXCLUDED."status",
           "files" = EXCLUDED."files",
           "updated_at" = now()`,
        actionId,
        requestId,
        normalizeDate(body.date ?? body.actionDate ?? body.action_date),
        normalizeTime(body.time ?? body.actionTime ?? body.action_time),
        cleanText(body.description ?? body.note ?? body.actionText ?? "", 3000),
        nextStatus,
        JSON.stringify(normalizeFiles(body.files)),
        Number(userId)
      );

      const workflowData = statusData(nextStatus, row, history, userId);
      return tx.paymentRequest.update({
        where: { id: requestId },
        data: { ...workflowData, historyJson: history },
      });
    });
    const [updatedWithProject] = await attachProjects([updated]);
    const actionsMap = await actionsByRequestIds([requestId]);
    return json({ ok: true, item: serialize({ ...updatedWithProject, supplyActions: actionsMap.get(Number(requestId)) || [] }) });
  } catch (error) {
    console.error("supply_actions_post_error", error);
    if (error?.message === "action_request_mismatch") return json({ error: "invalid_action_id" }, 409);
    return json({ error: "internal_error" }, 500);
  }
}
