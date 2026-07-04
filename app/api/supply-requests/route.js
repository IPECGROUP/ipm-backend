import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";

export const runtime = "nodejs";

const REQUEST_DOC_ID = "supply_request";

const json = (data, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

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
  if (direct && /^\d+$/.test(String(direct))) return Number(direct);

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

function createdHistory(row) {
  const history = Array.isArray(row?.historyJson) ? row.historyJson : [];
  return history.find((entry) => entry?.type === "created") || {};
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

async function creatorContext(userId) {
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: { id: true, name: true, username: true, email: true, department: true },
  });
  const userUnit = await prisma.userUnit.findFirst({
    where: { userId: Number(userId) },
    include: { unit: true },
    orderBy: { unitId: "asc" },
  });
  const userName = user?.username || user?.name || user?.email || `کاربر #${userId}`;
  const unitName = userUnit?.unit?.name || user?.department || "نامشخص";
  return { user, userName, unitName };
}

function serializeItem(row) {
  if (!row) return null;
  const created = createdHistory(row);
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

async function makeSerial({ dateJalali, project }) {
  const yy = getJalaliYY(dateJalali);
  const projectCode = normalizeProjectCode(project?.code);
  if (!projectCode) return null;

  const prefix = `${yy}/${projectCode}/`;
  const rows = await prisma.paymentRequest.findMany({
    where: {
      docId: REQUEST_DOC_ID,
      serial: { startsWith: prefix },
    },
    select: { serial: true },
    take: 1000,
  });

  let maxSeq = 0;
  const re = new RegExp(`^${yy}/${projectCode}/(\\d{3})$`);
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

    const { mainAdmin } = await userContext(userId);
    const where = {
      docId: REQUEST_DOC_ID,
      ...(mainAdmin
        ? {}
        : {
            OR: [{ createdById: Number(userId) }, { currentAssigneeUserId: Number(userId) }],
          }),
    };

    const rows = await prisma.paymentRequest.findMany({
      where,
      include: {
        createdBy: { select: { name: true, username: true, email: true } },
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

    return json({
      items: rows.map((row) => serializeItem({ ...row, project: projectById.get(Number(row.projectId)) || null })),
    });
  } catch (e) {
    console.error("supply_requests_get_error", e);
    return json({ error: "internal_error" }, 500);
  }
}

export async function POST(req) {
  try {
    const userId = await getUserId(req);
    if (!userId) return json({ error: "unauthorized" }, 401);

    const body = await readJson(req);
    const projectId = toPositiveInt(body.projectId ?? body.project_id);
    const project = await resolveProject(projectId);
    if (!project) return json({ error: "active_project_not_found" }, 404);

    const title = cleanText(body.title, 255);
    const budgetCode = cleanText(body.budgetCode ?? body.budget_code, 80);
    const dateJalali = cleanText(body.dateJalali ?? body.dateFa ?? body.date_jalali, 20);
    const needDateJalali = cleanText(body.needDateJalali ?? body.need_date_jalali, 20);
    const description = cleanText(body.description, 2000);
    const amount = toBigIntAmount(body.amount);

    if (!title) return json({ error: "title_required" }, 400);
    if (!budgetCode) return json({ error: "budget_code_required" }, 400);
    if (amount <= 0n) return json({ error: "amount_must_be_positive" }, 400);

    const marandi = await prisma.user.findFirst({
      where: { OR: [{ username: "marandi" }, { email: "marandi@ipecgroup.net" }] },
      select: { id: true },
    });

    const serial = await makeSerial({ dateJalali, project });
    if (!serial) return json({ error: "serial_generation_failed" }, 400);

    const now = new Date();
    const nowIso = now.toISOString();
    const { userName, unitName } = await creatorContext(userId);
    const registrationInfo = {
      ...formatRegistrationDateTime(now),
      userId: Number(userId),
      userName,
      unitName,
    };
    const relatedLetterIds = normalizeIdList(body.relatedLetterIds ?? body.related_letter_ids);
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
        currentAssigneeUserId: marandi?.id || null,
        status: "pending",
        historyJson: [
          {
            byUserId: Number(userId),
            type: "created",
            status: "pending",
            note: "",
            at: nowIso,
            requestKind: REQUEST_DOC_ID,
            registrationInfo,
            relatedLetterIds,
          },
        ],
      },
      include: { createdBy: { select: { name: true, username: true, email: true } } },
    });

    return json({ ok: true, item: serializeItem({ ...created, project }) }, 201);
  } catch (e) {
    console.error("supply_requests_post_error", e);
    return json({ error: "internal_error" }, 500);
  }
}

export async function DELETE(req) {
  try {
    const userId = await getUserId(req);
    if (!userId) return json({ error: "unauthorized" }, 401);

    const url = new URL(req.url);
    const id = toPositiveInt(url.searchParams.get("id"));
    if (!id) return json({ error: "invalid_id" }, 400);

    const { mainAdmin } = await userContext(userId);
    const row = await prisma.paymentRequest.findFirst({
      where: { id, docId: REQUEST_DOC_ID },
      select: { id: true, createdById: true },
    });
    if (!row) return json({ error: "not_found" }, 404);
    if (!mainAdmin && Number(row.createdById) !== Number(userId)) return json({ error: "forbidden" }, 403);

    await prisma.paymentRequest.delete({ where: { id } });
    return json({ ok: true });
  } catch (e) {
    console.error("supply_requests_delete_error", e);
    return json({ error: "internal_error" }, 500);
  }
}
