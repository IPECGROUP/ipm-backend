import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}
function bad(message, status = 400) {
  return json({ error: message }, status);
}

const ADMIN_USERNAME = "marandi1234";

// ✅ ادمین + rastegar می‌تونن محرمانه رو ببینن (و در این کد: بسازن/ویرایش/حذف هم بکنن)
const CONF_ALLOWED_USERNAMES = new Set([
  ADMIN_USERNAME.toLowerCase(),
  "rastegar",
]);

const CONF_LABEL = "محرمانه";
const CONF_SCOPE = "letters";

/* ----------------------- helpers: mapping ----------------------- */

function toSnakeLetter(l) {
  if (!l) return null;
  return {
    id: l.id,
    kind: l.kind,

    doc_class: l.docClass ?? "",
    classification_id: l.classificationId ?? null,

    category: l.category ?? "",
    project_id: l.projectId ?? null,
    internal_unit_id: l.internalUnitId ?? null,

    letter_no: l.letterNo ?? "",
    letter_date: l.letterDate ?? "",
    from_name: l.fromName ?? "",
    to_name: l.toName ?? "",
    org_name: l.orgName ?? "",
    subject: l.subject ?? "",

    has_attachment: !!l.hasAttachment,
    attachment_title: l.attachmentTitle ?? "",

    return_to_ids: l.returnToIds ?? [],
    piro_ids: l.piroIds ?? [],
    tag_ids: l.tagIds ?? [],

    secretariat_date: l.secretariatDate ?? "",
    secretariat_no: l.secretariatNo ?? "",
    secretariat_note: l.secretariatNote ?? "",
    receiver_name: l.receiverName ?? "",

    attachments: l.attachments ?? [],

    created_by: l.createdBy ?? null,
    created_at: l.createdAt,
    updated_at: l.updatedAt,
  };
}

function toSnakePrefs(p) {
  const safeArr = (v) => (Array.isArray(v) ? v : []);
  return {
    user_id: p?.userId ?? null,

    all_tag_ids: safeArr(p?.allTagIds),
    incoming_tag_ids: safeArr(p?.incomingTagIds),
    outgoing_tag_ids: safeArr(p?.outgoingTagIds),
    internal_tag_ids: safeArr(p?.internalTagIds),

    all_classification_id: p?.allClassificationId ?? null,
    incoming_classification_id: p?.incomingClassificationId ?? null,
    outgoing_classification_id: p?.outgoingClassificationId ?? null,
    internal_classification_id: p?.internalClassificationId ?? null,

    created_at: p?.createdAt ?? null,
    updated_at: p?.updatedAt ?? null,
  };
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}

function parseOptionalId(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

/* ----------------------- auth (secure) ----------------------- */
/**
 * اولویت امنیتی:
 * 1) session cookie -> Session -> User
 * 2) fallback x-user-id / cookie user_id -> User  (کم‌امن‌تر ولی سازگار با کد فعلی)
 */
async function getSessionId(req) {
  const sid =
    (req?.cookies?.get?.("session_id")?.value ||
      req?.cookies?.get?.("session")?.value ||
      req?.cookies?.get?.("sid")?.value ||
      "")
      .toString()
      .trim();
  return sid || "";
}

async function getAuth(req) {
  try {
    // 1) session
    const sid = await getSessionId(req);
    if (sid) {
      const s = await prisma.session.findUnique({
        where: { id: sid },
        include: { user: true },
      });

      if (s) {
        const exp = new Date(s.expiresAt).getTime();
        const now = Date.now();
        if (Number.isFinite(exp) && exp > now && s.user) {
          const user = s.user;
          const username = String(user.username || "").toLowerCase();

          const isAdmin =
            username === ADMIN_USERNAME.toLowerCase() ||
            String(user.role || "").toLowerCase() === "admin";

          const canSeeConfidential = isAdmin || CONF_ALLOWED_USERNAMES.has(username);

          return {
            user,
            userId: user.id,
            isAdmin,
            canSeeConfidential,
            via: "session",
          };
        }
      }
    }

    // 2) fallback userId from header/cookie
    const h =
      (req?.headers?.get?.("x-user-id") || req?.headers?.get?.("x-userid") || "")
        .toString()
        .trim();
    const c =
      (req?.cookies?.get?.("user_id")?.value ||
        req?.cookies?.get?.("userid")?.value ||
        "")
        .toString()
        .trim();
    const raw = h || c;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      const user = await prisma.user.findUnique({ where: { id: n } });
      if (user) {
        const username = String(user.username || "").toLowerCase();

        const isAdmin =
          username === ADMIN_USERNAME.toLowerCase() ||
          String(user.role || "").toLowerCase() === "admin";

        const canSeeConfidential = isAdmin || CONF_ALLOWED_USERNAMES.has(username);

        return { user, userId: user.id, isAdmin, canSeeConfidential, via: "fallback" };
      }
    }

    return { user: null, userId: null, isAdmin: false, canSeeConfidential: false, via: "none" };
  } catch {
    return { user: null, userId: null, isAdmin: false, canSeeConfidential: false, via: "error" };
  }
}

/* ----------------------- confidential logic ----------------------- */

/**
 * آیدی TagCategory محرمانه را از DB می‌گیریم (scope=letters, label=محرمانه)
 * برای اینکه هر بار query اضافه نزنیم، cache ساده داخل ماژول داریم.
 */
let _cachedConfClassId = null;
let _cachedConfClassIdAt = 0;

async function getConfClassificationId() {
  const now = Date.now();
  // cache 60 ثانیه‌ای
  if (_cachedConfClassIdAt && now - _cachedConfClassIdAt < 60_000) return _cachedConfClassId;

  const row = await prisma.tagCategory.findFirst({
    where: { scope: CONF_SCOPE, label: CONF_LABEL },
    select: { id: true },
  });

  _cachedConfClassId = row?.id ?? null;
  _cachedConfClassIdAt = now;
  return _cachedConfClassId;
}

async function isConfidentialRow(letterRow) {
  if (!letterRow) return false;
  if (String(letterRow.docClass || "").trim() === CONF_LABEL) return true;

  const confId = await getConfClassificationId();
  if (confId && Number(letterRow.classificationId) === Number(confId)) return true;

  return false;
}

async function confidentialWhereClause() {
  const confId = await getConfClassificationId();
  const ors = [{ docClass: CONF_LABEL }];
  if (confId) ors.push({ classificationId: confId });
  return ors.length === 1 ? ors[0] : { OR: ors };
}

/* ----------------------- payload normalizers ----------------------- */

function normalizeIncomingPayload(body) {
  const b = body || {};

  const rawKindText = String(b.kind || b.type || b.direction || "").trim();
  const kindRaw = rawKindText.toLowerCase();

  const kind =
    kindRaw.includes("out") || rawKindText.includes("صادر")
      ? "outgoing"
      : kindRaw.includes("int") ||
        kindRaw.includes("internal") ||
        kindRaw.includes("dakheli") ||
        rawKindText.includes("داخلی")
      ? "internal"
      : kindRaw.includes("in") || rawKindText.includes("وارده")
      ? "incoming"
      : "incoming";

  const projectIdParsed = parseOptionalId(b.projectId ?? b.project_id ?? null);
  const projectId = projectIdParsed === undefined ? null : projectIdParsed;

  const classificationIdParsed = parseOptionalId(b.classificationId ?? b.classification_id ?? null);
  const classificationId = classificationIdParsed === undefined ? null : classificationIdParsed;

  const internalUnitIdParsed = parseOptionalId(b.internalUnitId ?? b.internal_unit_id ?? null);
  const internalUnitId = internalUnitIdParsed === undefined ? null : internalUnitIdParsed;

  const hasAttachment = !!(b.hasAttachment ?? b.has_attachment);
  const attachments = Array.isArray(b.attachments) ? b.attachments : [];

  // اگر از UI متن طبقه‌بندی میاد (عادی/محرمانه) آن را به docClass هم نگاشت می‌کنیم
  const classificationText = String(b.classification ?? "").trim();
  const docClass = (b.docClass ?? b.doc_class ?? classificationText ?? "").toString();

  return {
    kind,
    docClass,
    classificationId,
    internalUnitId,

    category: b.category ?? "",
    projectId,

    letterNo: b.letterNo ?? b.letter_no ?? "",
    letterDate: b.letterDate ?? b.letter_date ?? "",
    fromName: b.fromName ?? b.from_name ?? "",
    toName: b.toName ?? b.to_name ?? "",
    orgName: b.orgName ?? b.org_name ?? "",
    subject: b.subject ?? "",

    hasAttachment,
    attachmentTitle: b.attachmentTitle ?? b.attachment_title ?? "",
    returnToIds: ensureArray(b.returnToIds ?? b.return_to_ids),
    piroIds: ensureArray(b.piroIds ?? b.piro_ids),
    tagIds: ensureArray(b.tagIds ?? b.tag_ids),

    secretariatDate: b.secretariatDate ?? b.secretariat_date ?? "",
    secretariatNo: b.secretariatNo ?? b.secretariat_no ?? "",
    secretariatNote: b.secretariatNote ?? b.secretariat_note ?? "",
    receiverName: b.receiverName ?? b.receiver_name ?? "",
    attachments,
  };
}

function normalizePatchPayload(body) {
  const b = body || {};
  const out = {};

  if (hasOwn(b, "kind") || hasOwn(b, "type") || hasOwn(b, "direction")) {
    const rawKindText = String(b.kind ?? b.type ?? b.direction ?? "").trim();
    const kindRaw = rawKindText.toLowerCase();

    out.kind =
      kindRaw.includes("out") || rawKindText.includes("صادر")
        ? "outgoing"
        : kindRaw.includes("int") ||
          kindRaw.includes("internal") ||
          kindRaw.includes("dakheli") ||
          rawKindText.includes("داخلی")
        ? "internal"
        : kindRaw.includes("in") || rawKindText.includes("وارده")
        ? "incoming"
        : String(b.kind ?? b.type ?? b.direction ?? "");
  }

  if (hasOwn(b, "projectId") || hasOwn(b, "project_id")) {
    const parsed = parseOptionalId(b.projectId ?? b.project_id);
    if (parsed === undefined) out.__invalid_project_id = true;
    else out.projectId = parsed;
  }

  if (hasOwn(b, "classificationId") || hasOwn(b, "classification_id")) {
    const parsed = parseOptionalId(b.classificationId ?? b.classification_id);
    if (parsed === undefined) out.__invalid_classification_id = true;
    else out.classificationId = parsed;
  }

  if (hasOwn(b, "internalUnitId") || hasOwn(b, "internal_unit_id")) {
    const parsed = parseOptionalId(b.internalUnitId ?? b.internal_unit_id);
    if (parsed === undefined) out.__invalid_internal_unit_id = true;
    else out.internalUnitId = parsed;
  }

  if (hasOwn(b, "hasAttachment") || hasOwn(b, "has_attachment")) {
    out.hasAttachment = !!(b.hasAttachment ?? b.has_attachment);
  }

  if (hasOwn(b, "classification") && !hasOwn(b, "docClass") && !hasOwn(b, "doc_class")) {
    out.docClass = String(b.classification ?? "").trim();
  }

  if (hasOwn(b, "docClass") || hasOwn(b, "doc_class")) out.docClass = b.docClass ?? b.doc_class ?? "";
  if (hasOwn(b, "category")) out.category = b.category ?? "";
  if (hasOwn(b, "letterNo") || hasOwn(b, "letter_no")) out.letterNo = b.letterNo ?? b.letter_no ?? "";
  if (hasOwn(b, "letterDate") || hasOwn(b, "letter_date")) out.letterDate = b.letterDate ?? b.letter_date ?? "";
  if (hasOwn(b, "fromName") || hasOwn(b, "from_name")) out.fromName = b.fromName ?? b.from_name ?? "";
  if (hasOwn(b, "toName") || hasOwn(b, "to_name")) out.toName = b.toName ?? b.to_name ?? "";
  if (hasOwn(b, "orgName") || hasOwn(b, "org_name")) out.orgName = b.orgName ?? b.org_name ?? "";
  if (hasOwn(b, "subject")) out.subject = b.subject ?? "";
  if (hasOwn(b, "attachmentTitle") || hasOwn(b, "attachment_title")) out.attachmentTitle = b.attachmentTitle ?? b.attachment_title ?? "";
  if (hasOwn(b, "secretariatDate") || hasOwn(b, "secretariat_date")) out.secretariatDate = b.secretariatDate ?? b.secretariat_date ?? "";
  if (hasOwn(b, "secretariatNo") || hasOwn(b, "secretariat_no")) out.secretariatNo = b.secretariatNo ?? b.secretariat_no ?? "";
  if (hasOwn(b, "secretariatNote") || hasOwn(b, "secretariat_note")) out.secretariatNote = b.secretariatNote ?? b.secretariat_note ?? "";
  if (hasOwn(b, "receiverName") || hasOwn(b, "receiver_name")) out.receiverName = b.receiverName ?? b.receiver_name ?? "";

  if (hasOwn(b, "returnToIds") || hasOwn(b, "return_to_ids")) {
    const v = b.returnToIds ?? b.return_to_ids;
    if (!Array.isArray(v)) out.__invalid_return_to_ids = true;
    else out.returnToIds = v;
  }
  if (hasOwn(b, "piroIds") || hasOwn(b, "piro_ids")) {
    const v = b.piroIds ?? b.piro_ids;
    if (!Array.isArray(v)) out.__invalid_piro_ids = true;
    else out.piroIds = v;
  }
  if (hasOwn(b, "tagIds") || hasOwn(b, "tag_ids")) {
    const v = b.tagIds ?? b.tag_ids;
    if (!Array.isArray(v)) out.__invalid_tag_ids = true;
    else out.tagIds = v;
  }
  if (hasOwn(b, "attachments")) {
    const v = b.attachments;
    if (!Array.isArray(v)) out.__invalid_attachments = true;
    else out.attachments = v;
  }

  return out;
}

function normalizeIdArray(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v) {
    if (x === "" || x == null) continue;
    const n = Number(x);
    out.push(Number.isFinite(n) ? n : x);
  }
  return out;
}

function normalizePrefsPayload(body) {
  const b = body || {};
  const out = {};

  if (hasOwn(b, "allTagIds") || hasOwn(b, "all_tag_ids"))
    out.allTagIds = normalizeIdArray(b.allTagIds ?? b.all_tag_ids);
  if (hasOwn(b, "incomingTagIds") || hasOwn(b, "incoming_tag_ids"))
    out.incomingTagIds = normalizeIdArray(b.incomingTagIds ?? b.incoming_tag_ids);
  if (hasOwn(b, "outgoingTagIds") || hasOwn(b, "outgoing_tag_ids"))
    out.outgoingTagIds = normalizeIdArray(b.outgoingTagIds ?? b.outgoing_tag_ids);
  if (hasOwn(b, "internalTagIds") || hasOwn(b, "internal_tag_ids"))
    out.internalTagIds = normalizeIdArray(b.internalTagIds ?? b.internal_tag_ids);

  if (hasOwn(b, "allClassificationId") || hasOwn(b, "all_classification_id")) {
    const parsed = parseOptionalId(b.allClassificationId ?? b.all_classification_id);
    if (parsed === undefined) out.__invalid_all_classification_id = true;
    else out.allClassificationId = parsed;
  }
  if (hasOwn(b, "incomingClassificationId") || hasOwn(b, "incoming_classification_id")) {
    const parsed = parseOptionalId(b.incomingClassificationId ?? b.incoming_classification_id);
    if (parsed === undefined) out.__invalid_incoming_classification_id = true;
    else out.incomingClassificationId = parsed;
  }
  if (hasOwn(b, "outgoingClassificationId") || hasOwn(b, "outgoing_classification_id")) {
    const parsed = parseOptionalId(b.outgoingClassificationId ?? b.outgoing_classification_id);
    if (parsed === undefined) out.__invalid_outgoing_classification_id = true;
    else out.outgoingClassificationId = parsed;
  }
  if (hasOwn(b, "internalClassificationId") || hasOwn(b, "internal_classification_id")) {
    const parsed = parseOptionalId(b.internalClassificationId ?? b.internal_classification_id);
    if (parsed === undefined) out.__invalid_internal_classification_id = true;
    else out.internalClassificationId = parsed;
  }

  return out;
}

async function readJsonSafely(req) {
  const txt = await req.text();
  if (!txt) return {};
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error("invalid_json");
  }
}

/* ----------------------- queries with filtering ----------------------- */

async function listLetters({ createdBy = null, allowConfidential = false } = {}) {
  const base = createdBy ? { createdBy } : {};
  if (allowConfidential) {
    const items = await prisma.letter.findMany({ where: base, orderBy: { id: "desc" } });
    return items.map(toSnakeLetter);
  }

  const confWhere = await confidentialWhereClause();
  const where = { AND: [base, { NOT: confWhere }] };

  const items = await prisma.letter.findMany({
    where,
    orderBy: { id: "desc" },
  });
  return items.map(toSnakeLetter);
}

function getIdFromReq(req, ctx) {
  let url;
  try {
    url = new URL(req.url);
  } catch {
    url = new URL(req.url, "http://localhost");
  }

  const ps = ctx?.params?.slug;
  let idRaw = null;

  if (Array.isArray(ps) && ps.length) idRaw = ps[0];
  else if (typeof ps === "string" && ps) idRaw = ps;

  if (!idRaw) idRaw = url.searchParams.get("id") || url.searchParams.get("letter_id");

  if (!idRaw) {
    const parts = url.pathname.split("/").filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (/^\d+$/.test(parts[i])) {
        idRaw = parts[i];
        break;
      }
    }
  }

  if (!idRaw || !/^\d+$/.test(String(idRaw))) return null;
  return Number(idRaw);
}

/* ----------------------- handlers ----------------------- */

export async function GET(req, ctx) {
  try {
    const slug = ctx?.params?.slug || [];
    const p0 = slug[0] || "";

    const auth = await getAuth(req);
    const allowConfidential = !!auth.canSeeConfidential;

    // prefs
    if (p0 === "prefs") {
      if (!auth.userId) return bad("unauthorized", 401);

      const prefs = await prisma.userLetterPrefs.findUnique({
        where: { userId: auth.userId },
      });

      if (!prefs) {
        return json({
          prefs: toSnakePrefs({
            userId: auth.userId,
            allTagIds: [],
            incomingTagIds: [],
            outgoingTagIds: [],
            internalTagIds: [],
            allClassificationId: null,
            incomingClassificationId: null,
            outgoingClassificationId: null,
            internalClassificationId: null,
            createdAt: null,
            updatedAt: null,
          }),
        });
      }

      return json({ prefs: toSnakePrefs(prefs) });
    }

    // mine
    if (p0 === "mine") {
      if (!auth.userId) return bad("unauthorized", 401);

      const items = await listLetters({
        createdBy: String(auth.userId),
        allowConfidential,
      });
      return json({ items });
    }

    // single by id
    if (p0 && /^\d+$/.test(String(p0))) {
      const id = Number(p0);
      const l = await prisma.letter.findUnique({ where: { id } });
      if (!l) return bad("not_found", 404);

      if (!allowConfidential) {
        const conf = await isConfidentialRow(l);
        if (conf) return bad("not_found", 404);
      }

      return json({ item: toSnakeLetter(l) });
    }

    // list all
    const items = await listLetters({ createdBy: null, allowConfidential });
    return json({ items });
  } catch (e) {
    return bad(e?.message || "request_failed", 500);
  }
}

export async function POST(req, ctx) {
  try {
    const slug = ctx?.params?.slug || [];
    const p0 = slug[0] || "";

    const auth = await getAuth(req);

    // prefs
    if (p0 === "prefs") {
      if (!auth.userId) return bad("unauthorized", 401);

      const raw = await readJsonSafely(req);
      const patch = normalizePrefsPayload(raw);

      if (
        patch.__invalid_all_classification_id ||
        patch.__invalid_incoming_classification_id ||
        patch.__invalid_outgoing_classification_id ||
        patch.__invalid_internal_classification_id
      ) {
        return bad("invalid_classification_id");
      }

      const updated = await prisma.userLetterPrefs.upsert({
        where: { userId: auth.userId },
        create: { userId: auth.userId, ...patch },
        update: { ...patch },
      });

      return json({ prefs: toSnakePrefs(updated) }, 201);
    }

    // create letter
    const ct = req.headers.get("content-type") || "";
    let payload = {};

    if (ct.includes("application/json")) {
      payload = normalizeIncomingPayload(await readJsonSafely(req));
    } else {
      const fd = await req.formData();
      const dataRaw = fd.get("data");
      if (dataRaw) {
        let obj = {};
        try {
          obj = JSON.parse(String(dataRaw));
        } catch {
          return bad("invalid_data_json");
        }
        payload = normalizeIncomingPayload(obj);
      } else {
        payload = normalizeIncomingPayload({});
      }
    }

    // ✅ فقط کسانی که اجازه دیدن محرمانه دارند، اجازه ثبت محرمانه هم دارند
    if (!auth.canSeeConfidential) {
      const confId = await getConfClassificationId();
      const triesConf =
        String(payload.docClass || "").trim() === CONF_LABEL ||
        (confId && Number(payload.classificationId) === Number(confId));

      if (triesConf) return bad("forbidden", 403);
    }

    const created = await prisma.letter.create({
      data: {
        kind: payload.kind,

        docClass: payload.docClass ? String(payload.docClass) : null,
        classificationId: payload.classificationId ?? null,
        internalUnitId: payload.internalUnitId ?? null,

        category: payload.category || null,
        projectId: payload.projectId ?? null,

        letterNo: payload.letterNo || null,
        letterDate: payload.letterDate || null,
        fromName: payload.fromName || null,
        toName: payload.toName || null,
        orgName: payload.orgName || null,
        subject: payload.subject || null,

        hasAttachment: !!payload.hasAttachment,
        attachmentTitle: payload.attachmentTitle || null,

        returnToIds: payload.returnToIds ?? [],
        piroIds: payload.piroIds ?? [],
        tagIds: payload.tagIds ?? [],

        secretariatDate: payload.secretariatDate || null,
        secretariatNo: payload.secretariatNo || null,
        secretariatNote: payload.secretariatNote || null,
        receiverName: payload.receiverName || null,

        attachments: payload.attachments ?? [],

        createdBy: auth.userId ? String(auth.userId) : null,
      },
    });

    return json({ item: toSnakeLetter(created) }, 201);
  } catch (e) {
    if (e?.message === "invalid_json") return bad("invalid_json");
    return bad(e?.message || "request_failed", 500);
  }
}

export async function PATCH(req, ctx) {
  try {
    const auth = await getAuth(req);

    const raw = await readJsonSafely(req);

    let id = getIdFromReq(req, ctx);
    if (!id) {
      const idMaybe =
        raw?.id ??
        raw?.letter_id ??
        raw?.letterId ??
        raw?.letterID ??
        raw?.letter?.id ??
        null;

      if (idMaybe != null && /^\d+$/.test(String(idMaybe))) id = Number(idMaybe);
    }
    if (!id) return bad("missing_id");

    const body = normalizePatchPayload(raw);

    if (body.__invalid_project_id) return bad("invalid_project_id");
    if (body.__invalid_classification_id) return bad("invalid_classification_id");
    if (body.__invalid_internal_unit_id) return bad("invalid_internal_unit_id");
    if (body.__invalid_return_to_ids) return bad("invalid_return_to_ids");
    if (body.__invalid_piro_ids) return bad("invalid_piro_ids");
    if (body.__invalid_tag_ids) return bad("invalid_tag_ids");
    if (body.__invalid_attachments) return bad("invalid_attachments");

    const existing = await prisma.letter.findUnique({ where: { id } });
    if (!existing) return bad("not_found", 404);

    // اگر نامه محرمانه است، فقط مجازها حق تغییر/ویرایش دارند
    if (!auth.canSeeConfidential) {
      const conf = await isConfidentialRow(existing);
      if (conf) return bad("forbidden", 403);
    }

    // غیرمجاز نتونه محرمانه کنه
    if (!auth.canSeeConfidential) {
      const confId = await getConfClassificationId();
      const nextDocClass = hasOwn(body, "docClass") ? String(body.docClass || "").trim() : null;
      const nextClassId = hasOwn(body, "classificationId") ? body.classificationId : null;

      const triesToMakeConf =
        (nextDocClass && nextDocClass === CONF_LABEL) ||
        (confId && nextClassId != null && Number(nextClassId) === Number(confId));

      if (triesToMakeConf) return bad("forbidden", 403);
    }

    const data = {};

    if (hasOwn(body, "kind")) data.kind = body.kind;

    if (hasOwn(body, "docClass"))
      data.docClass = body.docClass === "" ? null : (body.docClass ?? existing.docClass);

    if (hasOwn(body, "classificationId")) data.classificationId = body.classificationId;
    if (hasOwn(body, "internalUnitId")) data.internalUnitId = body.internalUnitId;

    if (hasOwn(body, "category"))
      data.category = body.category === "" ? null : (body.category ?? existing.category);

    if (hasOwn(body, "projectId")) data.projectId = body.projectId;

    if (hasOwn(body, "letterNo"))
      data.letterNo = body.letterNo === "" ? null : (body.letterNo ?? existing.letterNo);

    if (hasOwn(body, "letterDate"))
      data.letterDate = body.letterDate === "" ? null : (body.letterDate ?? existing.letterDate);

    if (hasOwn(body, "fromName"))
      data.fromName = body.fromName === "" ? null : (body.fromName ?? existing.fromName);

    if (hasOwn(body, "toName"))
      data.toName = body.toName === "" ? null : (body.toName ?? existing.toName);

    if (hasOwn(body, "orgName"))
      data.orgName = body.orgName === "" ? null : (body.orgName ?? existing.orgName);

    if (hasOwn(body, "subject"))
      data.subject = body.subject === "" ? null : (body.subject ?? existing.subject);

    if (hasOwn(body, "hasAttachment")) data.hasAttachment = body.hasAttachment;

    if (hasOwn(body, "attachmentTitle"))
      data.attachmentTitle =
        body.attachmentTitle === "" ? null : (body.attachmentTitle ?? existing.attachmentTitle);

    if (hasOwn(body, "returnToIds")) data.returnToIds = body.returnToIds;
    if (hasOwn(body, "piroIds")) data.piroIds = body.piroIds;
    if (hasOwn(body, "tagIds")) data.tagIds = body.tagIds;

    if (hasOwn(body, "secretariatDate"))
      data.secretariatDate =
        body.secretariatDate === "" ? null : (body.secretariatDate ?? existing.secretariatDate);

    if (hasOwn(body, "secretariatNo"))
      data.secretariatNo =
        body.secretariatNo === "" ? null : (body.secretariatNo ?? existing.secretariatNo);

    if (hasOwn(body, "secretariatNote"))
      data.secretariatNote =
        body.secretariatNote === "" ? null : (body.secretariatNote ?? existing.secretariatNote);

    if (hasOwn(body, "receiverName"))
      data.receiverName =
        body.receiverName === "" ? null : (body.receiverName ?? existing.receiverName);

    if (hasOwn(body, "attachments")) data.attachments = body.attachments;

    if (Object.keys(data).length === 0) {
      return json({ item: toSnakeLetter(existing) });
    }

    const updated = await prisma.letter.update({
      where: { id },
      data,
    });

    return json({ item: toSnakeLetter(updated) });
  } catch (e) {
    if (e?.message === "invalid_json") return bad("invalid_json");
    return bad(e?.message || "request_failed", 500);
  }
}

export async function DELETE(req, ctx) {
  try {
    const auth = await getAuth(req);

    const id = getIdFromReq(req, ctx);
    if (!id) return bad("missing_id");

    const existing = await prisma.letter.findUnique({ where: { id } });
    if (!existing) return bad("not_found", 404);

    // اگر نامه محرمانه است، فقط مجازها حق حذف دارند
    if (!auth.canSeeConfidential) {
      const conf = await isConfidentialRow(existing);
      if (conf) return bad("forbidden", 403);
    }

    await prisma.letter.delete({ where: { id } });

    return json({ ok: true });
  } catch (e) {
    if (e?.code === "P2025") return bad("not_found", 404);
    return bad(e?.message || "request_failed", 500);
  }
}
