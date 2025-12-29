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
  // اجازه بده رشته‌های عددی (با کاما) هم پاس بشن
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
    // اگر امن بود number بده، وگرنه string
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
  // فقط فیلدهایی که در UI هست (همون‌هایی که فرستادی)
  return {
    serial: body?.serial ?? body?.previewSerial ?? undefined,
    dateJalali: body?.dateJalali ?? body?.dateFa ?? body?.todayFa ?? body?.date_jalali ?? undefined,
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
      body?.currencyTypeId != null ? Number(body.currencyTypeId) : undefined,
    currencySourceId:
      body?.currencySourceId != null ? Number(body.currencySourceId) : undefined,

    projectId: body?.projectId != null ? Number(body.projectId) : undefined,
    budgetCode: body?.budgetCode ?? undefined,

    attachments: body?.attachments ?? body?.docFiles ?? undefined,
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

  const rows = await prisma.paymentRequest.findMany({
    where,
    orderBy: { id: "desc" },
    take: 500,
  });

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
    const status = String(body?.status || "").trim(); // approved/rejected/returned
    const note = (body?.note ?? "").toString();

    if (!Number.isFinite(id)) return json({ error: "invalid_id" }, 400);
    if (!["approved", "rejected", "returned"].includes(status))
      return json({ error: "invalid_status" }, 400);

    const row = await prisma.paymentRequest.findUnique({ where: { id } });
    if (!row) return json({ error: "not_found" }, 404);

    const history = Array.isArray(row.historyJson) ? row.historyJson : [];
    history.push({
      byUserId: userId,
      type: status,
      status,
      note,
      at: new Date().toISOString(),
    });

    // ساده: با همین اکشن status آپدیت میشه. (اگر خواستی بعداً ورک‌فلو/assignee هم اضافه می‌کنیم)
    const updated = await prisma.paymentRequest.update({
      where: { id },
      data: {
        status,
        historyJson: history,
      },
    });

    return json({ ok: true, item: normalizeOut(updated) });
  }

  // POST /api/requests (create)
  const body = (await readJson(req)) || {};
  const data = pickUpdatable(body);

  // حداقل‌ها
  const scope = data.scope || body?.active || body?.filterScope;
  const title = data.title;

  const amountBI = data.amount ?? toBigIntSafe(body?.amountStr) ?? BigInt(0);

  if (!scope) return json({ error: "scope_required" }, 400);
  if (!title) return json({ error: "title_required" }, 400);
  if (amountBI <= 0n) return json({ error: "amount_must_be_positive" }, 400);

  const created = await prisma.paymentRequest.create({
    data: {
      serial: data.serial ?? null,
      dateJalali: data.dateJalali ?? null,
      scope: scope,
      title: title,
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

      historyJson: [
        {
          byUserId: userId,
          type: "created",
          status: "pending",
          note: "",
          at: new Date().toISOString(),
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

  // amount اگر undefined بود، آپدیت نکن
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
