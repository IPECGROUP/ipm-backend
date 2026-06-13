import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

function bad(message, status = 400) {
  return json({ error: message }, status);
}

const DOC_CLASS_CLASSIFICATION_PREFIX = "__classification__:";

function encodeClassificationDocClassFallback(raw) {
  const label = normalizeClassificationLabel(raw);
  if (!label) return "";
  return `${DOC_CLASS_CLASSIFICATION_PREFIX}${label}`;
}

function decodeClassificationDocClassFallback(raw) {
  const src = String(raw ?? "").trim();
  if (!src) return "";
  if (src.startsWith(DOC_CLASS_CLASSIFICATION_PREFIX)) {
    return src.slice(DOC_CLASS_CLASSIFICATION_PREFIX.length).trim();
  }
  const normalized = normalizeClassificationLabel(src);
  return normalized || "";
}

function toSnakeLetter(l) {
  const docClassRaw = String(l?.docClass ?? "").trim();
  const classificationFromDocClass = decodeClassificationDocClassFallback(docClassRaw);
  if (!l) return null;
  const classificationLabel =
    l?.classificationLabel ??
    (typeof l?.classification === "object" ? l?.classification?.label : l?.classificationLabel) ??
    classificationFromDocClass ??
    "";
  const cls = String(classificationLabel || "").trim();
  const attachments = Array.isArray(l?.attachments) ? l.attachments : [];
  return {
    id: l.id,
    kind: l.kind,
    is_confidential: isConfidentialLabel(cls),

    doc_class: classificationFromDocClass ? "" : (l.docClass ?? ""),
    classification_id: l.classificationId ?? null,
    classification: cls,
    classification_label: cls,
    confidentiality: cls,
    doc_classification: cls,

    category: l.category ?? "",
    project_id: l.projectId ?? null,
    internal_unit_id: l.internalUnitId ?? null,
    unit_id: l.internalUnitId ?? null,
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
    attachments,
    created_by: l.createdBy ?? null,
    created_at: l.createdAt,
    updated_at: l.updatedAt,
  };
}

function toSnakePrefs(p) {
  // خروجی با snake_case که فرانت راحت بخونه
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
  if (!Number.isFinite(n)) return undefined; // invalid
  return n;
}

function pickClassificationText(v) {
  if (v == null) return "";
  if (typeof v === "object") {
    return String(v?.label ?? v?.name ?? "").trim();
  }
  return String(v).trim();
}

function normFa(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u200c\u200f\u202a-\u202e]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeClassificationLabel(raw) {
  const src = String(raw ?? "").trim();
  const v = normFa(src);
  if (!v) return "";

  if (v.includes("خیلی محرمانه")) return "محرمانه";
  if (v.includes("محرمانه")) return "محرمانه";
  if (v.includes("confidential")) return "محرمانه";
  if (v.includes("secret")) return "محرمانه";

  if (v.includes("عادی")) return "";
  if (v.includes("normal")) return "";

  return src;
}

function isMissingLettersClassificationInfraError(err) {
  const code = String(err?.code || "").trim();
  const msg = String(err?.message || "");
  if (code === "P2021" || code === "P2022") return true;
  if (!msg) return false;
  return (
    msg.includes("TagCategory") ||
    msg.includes("classification_label") ||
    msg.includes("classification_id")
  ) && (
    msg.includes("does not exist") ||
    msg.includes("Unknown argument") ||
    msg.includes("Unknown field") ||
    msg.includes("column")
  );
}

function isLettersClassificationCompatError(err) {
  if (isMissingLettersClassificationInfraError(err)) return true;
  const msg = String(err?.message || "");
  if (!msg) return false;
  const mentionsClassification =
    msg.includes("classificationLabel") ||
    msg.includes("classificationId") ||
    msg.includes("classification") ||
    msg.includes("TagCategory") ||
    msg.includes("LetterClassification");
  const looksLikePrismaCompatIssue =
    msg.includes("Unknown argument") ||
    msg.includes("Unknown field") ||
    msg.includes("does not exist") ||
    msg.includes("column");
  return mentionsClassification && looksLikePrismaCompatIssue;
}

function stripClassificationWriteFields(data) {
  const next = { ...(data || {}) };
  delete next.classificationLabel;
  delete next.classificationId;
  delete next.classification;
  return next;
}

function stripClassificationRelationFields(data) {
  const next = { ...(data || {}) };
  delete next.classificationId;
  delete next.classification;
  return next;
}

function hasClassificationWriteData(data) {
  return (
    hasOwn(data, "classificationLabel") ||
    hasOwn(data, "classificationId") ||
    hasOwn(data, "classification")
  );
}

function moveClassificationToDocClassFallback(data) {
  const next = stripClassificationWriteFields(data);
  const encoded = encodeClassificationDocClassFallback(data?.classificationLabel);
  next.docClass = encoded || null;
  return next;
}

let ensureLettersClassificationInfraPromise = null;

async function ensureLettersClassificationInfra() {
  if (!ensureLettersClassificationInfraPromise) {
    ensureLettersClassificationInfraPromise = (async () => {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "Letter"
        ADD COLUMN IF NOT EXISTS "classification_label" TEXT;
      `);

      await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'Letter'
              AND column_name = 'classification_id'
          ) AND EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'TagCategory'
          ) THEN
            UPDATE "Letter" AS l
            SET "classification_label" = tc."label"
            FROM "TagCategory" AS tc
            WHERE l."classification_id" = tc."id"
              AND (l."classification_label" IS NULL OR btrim(l."classification_label") = '');
          END IF;
        END $$;
      `);
    })().catch((err) => {
      ensureLettersClassificationInfraPromise = null;
      throw err;
    });
  }

  return ensureLettersClassificationInfraPromise;
}

const LETTER_CLASSIFICATION_INCLUDE = {
  classification: { select: { id: true, label: true } },
};

async function safeLetterFindMany(args = {}) {
  try {
    return await prisma.letter.findMany({
      ...args,
      include: {
        ...(args?.include || {}),
        ...LETTER_CLASSIFICATION_INCLUDE,
      },
    });
  } catch (err) {
    if (!isLettersClassificationCompatError(err)) throw err;
    const { include: _include, ...rest } = args || {};
    return await prisma.letter.findMany(rest);
  }
}

async function safeLetterFindUnique(args = {}) {
  try {
    return await prisma.letter.findUnique({
      ...args,
      include: {
        ...(args?.include || {}),
        ...LETTER_CLASSIFICATION_INCLUDE,
      },
    });
  } catch (err) {
    if (!isLettersClassificationCompatError(err)) throw err;
    const { include: _include, ...rest } = args || {};
    return await prisma.letter.findUnique(rest);
  }
}

async function safeLetterCreate(data) {
  try {
    return await prisma.letter.create({
      data,
      include: LETTER_CLASSIFICATION_INCLUDE,
    });
  } catch (err) {
    if (!isLettersClassificationCompatError(err)) throw err;
    console.warn("[letters] create fallback without classification relation");
    try {
      return await prisma.letter.create({
        data: stripClassificationRelationFields(data),
      });
    } catch (err2) {
      if (!isLettersClassificationCompatError(err2)) throw err2;
      if (hasClassificationWriteData(data)) {
        try {
          await ensureLettersClassificationInfra();
          return await prisma.letter.create({
            data: stripClassificationRelationFields(data),
          });
        } catch (infraErr) {
          console.warn("[letters] create fallback using docClass classification store");
          return await prisma.letter.create({
            data: moveClassificationToDocClassFallback(data),
          });
        }
      }
      console.warn("[letters] create fallback without classification fields");
      return await prisma.letter.create({
        data: stripClassificationWriteFields(data),
      });
    }
  }
}

async function safeLetterUpdate(id, data) {
  try {
    return await prisma.letter.update({
      where: { id },
      data,
      include: LETTER_CLASSIFICATION_INCLUDE,
    });
  } catch (err) {
    if (!isLettersClassificationCompatError(err)) throw err;
    console.warn("[letters] update fallback without classification relation");
    try {
      return await prisma.letter.update({
        where: { id },
        data: stripClassificationRelationFields(data),
      });
    } catch (err2) {
      if (!isLettersClassificationCompatError(err2)) throw err2;
      if (hasClassificationWriteData(data)) {
        try {
          await ensureLettersClassificationInfra();
          return await prisma.letter.update({
            where: { id },
            data: stripClassificationRelationFields(data),
          });
        } catch (infraErr) {
          console.warn("[letters] update fallback using docClass classification store");
          return await prisma.letter.update({
            where: { id },
            data: moveClassificationToDocClassFallback(data),
          });
        }
      }
      console.warn("[letters] update fallback without classification fields");
      return await prisma.letter.update({
        where: { id },
        data: stripClassificationWriteFields(data),
      });
    }
  }
}

function isConfidentialLabel(raw) {
  const v = normFa(raw);
  if (!v) return false;
  if (v.includes("خیلی محرمانه")) return true;
  if (v.includes("محرمانه")) return true;
  if (v.includes("confidential")) return true;
  if (v.includes("secret")) return true;
  return false;
}

const CONFIDENTIAL_ALLOWED_USERS = new Set(["marandi", "rastegar"]);

function normalizeViewerName(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

function isAllowedConfidentialViewerName(raw) {
  const name = normalizeViewerName(raw);
  return !!name && CONFIDENTIAL_ALLOWED_USERS.has(name);
}

function canViewConfidentialLetter(item, viewerCanSeeConfidential) {
  const raw =
    item?.classificationLabel ??
    item?.classification ??
    item?.classification_label ??
    item?.confidentiality ??
    item?.doc_classification ??
    "";
  const isConf = isConfidentialLabel(raw);
  if (!isConf) return true;
  return !!viewerCanSeeConfidential;
}

async function ensureLettersClassificationId(rawLabel) {
  const label = normalizeClassificationLabel(rawLabel);
  if (!label) return null;

  const found = await prisma.tagCategory.findFirst({
    where: { scope: "letters", label },
    select: { id: true },
  });
  if (found?.id) return found.id;

  try {
    const created = await prisma.tagCategory.create({
      data: { scope: "letters", label },
      select: { id: true },
    });
    return created?.id ?? null;
  } catch (e) {
    if (e?.code === "P2002") {
      const again = await prisma.tagCategory.findFirst({
        where: { scope: "letters", label },
        select: { id: true },
      });
      return again?.id ?? null;
    }
    throw e;
  }
}

async function resolveClassificationId({ classificationId, classificationText, keepUndefined = false }) {
  if (classificationId !== undefined) return classificationId;
  if (classificationText === undefined) return keepUndefined ? undefined : null;
  return await ensureLettersClassificationId(classificationText);
}

async function resolveClassificationState({
  classificationId,
  classificationText,
  keepUndefined = false,
}) {
  const normalizedLabel =
    classificationText === undefined
      ? keepUndefined
        ? undefined
        : null
      : normalizeClassificationLabel(classificationText) || null;

  try {
    const resolvedClassificationId = await resolveClassificationId({
      classificationId,
      classificationText,
      keepUndefined,
    });

    return {
      classificationId: resolvedClassificationId,
      classificationLabel: normalizedLabel,
    };
  } catch (err) {
    if (!isLettersClassificationCompatError(err)) throw err;

    console.warn("[letters] classification relation unavailable, saving text label only");

    return {
      classificationId: keepUndefined ? undefined : null,
      classificationLabel: normalizedLabel,
    };
  }
}

async function getViewerAccessInfo(req) {
  const userId = await getUserIdFromReq(req);
  if (!userId) {
    return {
      userId: null,
      canSeeConfidential: false,
      isMainAdmin: false,
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: { username: true, name: true },
  });

  const username = normalizeViewerName(user?.username || user?.name || "");
  const isMainAdmin = username === "marandi";

  return {
    userId,
    canSeeConfidential: isAllowedConfidentialViewerName(username),
    isMainAdmin,
  };
}

function hasMeaningfulLetterPayload(payload) {
  const hasText = (v) => String(v ?? "").trim() !== "";
  const hasItems = (v) => Array.isArray(v) && v.length > 0;

  return [
    payload?.docClass,
    payload?.classificationText,
    payload?.category,
    payload?.letterNo,
    payload?.letterDate,
    payload?.fromName,
    payload?.toName,
    payload?.orgName,
    payload?.subject,
    payload?.attachmentTitle,
    payload?.secretariatDate,
    payload?.secretariatNo,
    payload?.secretariatNote,
    payload?.receiverName,
  ].some(hasText) ||
    payload?.projectId != null ||
    payload?.internalUnitId != null ||
    payload?.classificationId != null ||
    payload?.hasAttachment === true ||
    hasItems(payload?.returnToIds) ||
    hasItems(payload?.piroIds) ||
    hasItems(payload?.tagIds) ||
    hasItems(payload?.attachments);
}

function toEnDigits(s) {
  return String(s ?? "")
    .replace(/[۰-۹]/g, (d) => "0123456789"["۰۱۲۳۴۵۶۷۸۹".indexOf(d)])
    .replace(/[٠-٩]/g, (d) => "0123456789"["٠١٢٣٤٥٦٧٨٩".indexOf(d)]);
}

function pad5(n) {
  return String(Number(n) || 0).padStart(5, "0");
}

function normalizeDigits(s) {
  return String(s ?? "")
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function getJalaliYY(date = new Date()) {
  const y = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    year: "numeric",
    timeZone: "Asia/Tehran",
  }).format(date);
  const en = normalizeDigits(y);
  return en.slice(-2);
}

function parseAutoCode(s) {
  const normalized = normalizeDigits(String(s || "").trim());
  const m = normalized.match(/^(\d{2})\/(\d{3})\/(\d{5})$/);
  if (!m) return null;
  return { yy: m[1], pcode: m[2], seq: Number(m[3]) };
}

function parsePlainSequence(s) {
  const v = normalizeDigits(String(s || "")).trim();
  if (!/^\d{5}$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseAutoLetterSequence(s, yy) {
  const normalized = normalizeDigits(String(s || "").trim());
  if (!normalized) return null;

  const parsed = parseAutoCode(normalized);
  if (!parsed || parsed.yy !== yy) return null;
  return Number.isFinite(parsed.seq) ? parsed.seq : null;
}

async function getProjectBaseCode(projectId) {
  const pid = Number(projectId);
  if (!Number.isFinite(pid) || pid <= 0) return "";

  const project = await prisma.project.findUnique({
    where: { id: pid },
    select: { code: true },
  });

  const raw = normalizeDigits(String(project?.code || "").trim());
  const base = raw.split(".")[0].trim();
  if (/^\d{3}$/.test(base)) return base;
  const m = raw.match(/^(\d{3})/);
  return m ? m[1] : "";
}

async function computeNextAutoCodeFromDb(projectId) {
  const yy = getJalaliYY(new Date());
  const pid = Number(projectId);
  const pcode = await getProjectBaseCode(pid);
  if (!pcode) return "";

  const startByYear = 10000;

  const items = await prisma.letter.findMany({
    select: {
      letterNo: true,
      secretariatNo: true,
    },
  });

  let maxAutoSeq = 0;
  let maxLegacyPlainSeq = 0;

  for (const l of items) {
    const rawCandidates = [
      l?.letterNo,
      l?.secretariatNo,
    ].filter((x) => String(x ?? "").trim());

    for (const rawNo of rawCandidates) {
      const autoSeq = parseAutoLetterSequence(rawNo, yy);
      if (Number.isFinite(autoSeq) && autoSeq > maxAutoSeq) maxAutoSeq = autoSeq;

      const plainSeq = parsePlainSequence(rawNo);
      if (Number.isFinite(plainSeq) && plainSeq > maxLegacyPlainSeq) {
        maxLegacyPlainSeq = plainSeq;
      }
    }
  }

  const maxSeq = maxAutoSeq || maxLegacyPlainSeq;
  const nextSeq = maxSeq >= startByYear ? (maxSeq + 1) : startByYear;
  return `${yy}/${pcode}/${pad5(nextSeq)}`;
}

async function computeNextLetterCodeFromDb(projectId) {
  return await computeNextAutoCodeFromDb(projectId);
}

async function resolveSecretariatNoForCreate(payload) {
  const raw = String(payload?.secretariatNo || "").trim();
  const nextCode = await computeNextLetterCodeFromDb(payload?.projectId);
  if (nextCode) return nextCode;
  return raw;
}

// تلاش برای گرفتن userId از Session (اگر session cookie دارید)
async function getUserIdFromSession(req) {
  try {
    const sid =
      (req?.cookies?.get?.("ipm_session")?.value ||
        req?.cookies?.get?.("session_id")?.value ||
        req?.cookies?.get?.("session")?.value ||
        req?.cookies?.get?.("sid")?.value ||
        "")
        .toString()
        .trim();

    if (!sid) return null;

    const s = await prisma.session.findUnique({ where: { id: sid } });
    if (!s) return null;

    // expire check
    const now = Date.now();
    const exp = new Date(s.expiresAt).getTime();
    if (!Number.isFinite(exp) || exp <= now) return null;

    return s.userId || null;
  } catch {
    return null;
  }
}

async function getUserIdFromReq(req) {
  // ✅ اول session (امن‌تر)
  const sidUser = await getUserIdFromSession(req);
  if (sidUser) return sidUser;

  // ✅ fallback روش قبلی تو (برای اینکه چیزی خراب نشه)
  try {
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
    if (!raw) return null;

    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function normalizeIncomingPayload(body) {
  const b = body || {};

  // داخل normalizeIncomingPayload
  // داخل normalizeIncomingPayload
  const rawKindText = String(b.kind || b.type || b.direction || "").trim();
  const kindRaw = rawKindText.toLowerCase();

  // ⚠️ ترتیب مهمه: internal قبل از in  (چون "internal" شامل "in" هست)
  const kind =
    kindRaw.includes("out") || rawKindText.includes("صادر") ? "outgoing"
    : kindRaw.includes("int") ||
      kindRaw.includes("internal") ||
      kindRaw.includes("dakheli") ||
      rawKindText.includes("داخلی")
      ? "internal"
    : kindRaw.includes("in") || rawKindText.includes("وارده") ? "incoming"
    : "incoming";

  const projectIdVal = b.projectId ?? b.project_id ?? null;
  const projectIdParsed = parseOptionalId(projectIdVal);
  const projectId = projectIdParsed === undefined ? null : projectIdParsed;

  const hasClassificationId =
    hasOwn(b, "classificationId") || hasOwn(b, "classification_id");
  let classificationId = undefined;
  if (hasClassificationId) {
    const classificationIdVal = b.classificationId ?? b.classification_id ?? null;
    const classificationIdParsed = parseOptionalId(classificationIdVal);
    classificationId =
      classificationIdParsed === undefined ? null : classificationIdParsed;
  }

  const hasClassificationText =
    hasOwn(b, "classification") ||
    hasOwn(b, "classification_label") ||
    hasOwn(b, "confidentiality");
  const rawClassificationText = hasClassificationText
    ? pickClassificationText(
      b.classification ??
      b.classification_label ??
      b.confidentiality
    )
    : undefined;
  const classificationText =
    rawClassificationText === undefined ? undefined : String(rawClassificationText ?? "").trim();

  const internalUnitIdVal =
    b.internalUnitId ?? b.internal_unit_id ?? b.unitId ?? b.unit_id ?? null;
  const internalUnitIdParsed = parseOptionalId(internalUnitIdVal);
  const internalUnitId =
    internalUnitIdParsed === undefined ? null : internalUnitIdParsed;

  const hasAttachment = !!(b.hasAttachment ?? b.has_attachment);
  const attachments = Array.isArray(b.attachments) ? b.attachments : [];

  return {
    kind,

    docClass: b.docClass ?? b.doc_class ?? "",
    classificationId,
    classificationText,

    category: b.category ?? "",
    projectId,
    internalUnitId,
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
    // داخل normalizePatchPayload
    const rawKindText = String(b.kind ?? b.type ?? b.direction ?? "").trim();
    const kindRaw = rawKindText.toLowerCase();

    // ⚠️ ترتیب مهمه: internal قبل از in
    out.kind =
      kindRaw.includes("out") || rawKindText.includes("صادر") ? "outgoing"
      : kindRaw.includes("int") ||
        kindRaw.includes("internal") ||
        kindRaw.includes("dakheli") ||
        rawKindText.includes("داخلی")
        ? "internal"
      : kindRaw.includes("in") || rawKindText.includes("وارده") ? "incoming"
      : String(b.kind ?? b.type ?? b.direction ?? "");
  }

  if (hasOwn(b, "projectId") || hasOwn(b, "project_id")) {
    const parsed = parseOptionalId(b.projectId ?? b.project_id);
    if (parsed === undefined) out.__invalid_project_id = true;
    else out.projectId = parsed;
  }

  if (
    hasOwn(b, "internalUnitId") ||
    hasOwn(b, "internal_unit_id") ||
    hasOwn(b, "unitId") ||
    hasOwn(b, "unit_id")
  ) {
    const parsed = parseOptionalId(
      b.internalUnitId ?? b.internal_unit_id ?? b.unitId ?? b.unit_id
    );
    if (parsed === undefined) out.__invalid_internal_unit_id = true;
    else out.internalUnitId = parsed;
  }

  if (hasOwn(b, "classificationId") || hasOwn(b, "classification_id")) {
    const parsed = parseOptionalId(b.classificationId ?? b.classification_id);
    if (parsed === undefined) out.__invalid_classification_id = true;
    else out.classificationId = parsed;
  }
  if (
    hasOwn(b, "classification") ||
    hasOwn(b, "classification_label") ||
    hasOwn(b, "confidentiality")
  ) {
    const raw = pickClassificationText(
      b.classification ??
      b.classification_label ??
      b.confidentiality
    );
    out.classificationText = String(raw ?? "").trim();
  }

  if (hasOwn(b, "hasAttachment") || hasOwn(b, "has_attachment")) {
    out.hasAttachment = !!(b.hasAttachment ?? b.has_attachment);
  }

  if (hasOwn(b, "docClass") || hasOwn(b, "doc_class"))
    out.docClass = b.docClass ?? b.doc_class ?? "";
  if (hasOwn(b, "category")) out.category = b.category ?? "";
  if (hasOwn(b, "letterNo") || hasOwn(b, "letter_no"))
    out.letterNo = b.letterNo ?? b.letter_no ?? "";
  if (hasOwn(b, "letterDate") || hasOwn(b, "letter_date"))
    out.letterDate = b.letterDate ?? b.letter_date ?? "";
  if (hasOwn(b, "fromName") || hasOwn(b, "from_name"))
    out.fromName = b.fromName ?? b.from_name ?? "";
  if (hasOwn(b, "toName") || hasOwn(b, "to_name"))
    out.toName = b.toName ?? b.to_name ?? "";
  if (hasOwn(b, "orgName") || hasOwn(b, "org_name"))
    out.orgName = b.orgName ?? b.org_name ?? "";
  if (hasOwn(b, "subject")) out.subject = b.subject ?? "";
  if (hasOwn(b, "attachmentTitle") || hasOwn(b, "attachment_title"))
    out.attachmentTitle = b.attachmentTitle ?? b.attachment_title ?? "";
  if (hasOwn(b, "secretariatDate") || hasOwn(b, "secretariat_date"))
    out.secretariatDate = b.secretariatDate ?? b.secretariat_date ?? "";
  if (hasOwn(b, "secretariatNo") || hasOwn(b, "secretariat_no"))
    out.secretariatNo = b.secretariatNo ?? b.secretariat_no ?? "";
  if (hasOwn(b, "secretariatNote") || hasOwn(b, "secretariat_note"))
    out.secretariatNote = b.secretariatNote ?? b.secretariat_note ?? "";
  if (hasOwn(b, "receiverName") || hasOwn(b, "receiver_name"))
    out.receiverName = b.receiverName ?? b.receiver_name ?? "";

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
  // اجازه می‌دهیم string/number بیاید؛ تبدیل به عدد اگر شد
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

  // tag arrays
  if (hasOwn(b, "allTagIds") || hasOwn(b, "all_tag_ids"))
    out.allTagIds = normalizeIdArray(b.allTagIds ?? b.all_tag_ids);

  if (hasOwn(b, "incomingTagIds") || hasOwn(b, "incoming_tag_ids"))
    out.incomingTagIds = normalizeIdArray(b.incomingTagIds ?? b.incoming_tag_ids);

  if (hasOwn(b, "outgoingTagIds") || hasOwn(b, "outgoing_tag_ids"))
    out.outgoingTagIds = normalizeIdArray(b.outgoingTagIds ?? b.outgoing_tag_ids);

  if (hasOwn(b, "internalTagIds") || hasOwn(b, "internal_tag_ids"))
    out.internalTagIds = normalizeIdArray(b.internalTagIds ?? b.internal_tag_ids);

  // classification ids
  if (hasOwn(b, "allClassificationId") || hasOwn(b, "all_classification_id")) {
    const parsed = parseOptionalId(b.allClassificationId ?? b.all_classification_id);
    if (parsed === undefined) out.__invalid_all_classification_id = true;
    else out.allClassificationId = parsed;
  }
  if (hasOwn(b, "incomingClassificationId") || hasOwn(b, "incoming_classification_id")) {
    const parsed = parseOptionalId(
      b.incomingClassificationId ?? b.incoming_classification_id
    );
    if (parsed === undefined) out.__invalid_incoming_classification_id = true;
    else out.incomingClassificationId = parsed;
  }
  if (hasOwn(b, "outgoingClassificationId") || hasOwn(b, "outgoing_classification_id")) {
    const parsed = parseOptionalId(
      b.outgoingClassificationId ?? b.outgoing_classification_id
    );
    if (parsed === undefined) out.__invalid_outgoing_classification_id = true;
    else out.outgoingClassificationId = parsed;
  }
  if (hasOwn(b, "internalClassificationId") || hasOwn(b, "internal_classification_id")) {
    const parsed = parseOptionalId(
      b.internalClassificationId ?? b.internal_classification_id
    );
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

async function listLetters({ createdBy = null, includePublic = false } = {}) {
  let where = {};
  if (createdBy && includePublic) {
    where = {
      OR: [{ createdBy }, { createdBy: null }, { createdBy: "" }],
    };
  } else if (createdBy) {
    where = { createdBy };
  }

  const items = await safeLetterFindMany({
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

// ✅ حذف فایل‌های ضمیمه (بهترین تلاش) — اگر آدرس‌ها لوکال باشند از public حذف می‌کند
async function tryDeleteAttachmentFiles(letters) {
  try {
    const pub = path.join(process.cwd(), "public");
    const files = new Set();

    for (const l of Array.isArray(letters) ? letters : []) {
      const atts = Array.isArray(l?.attachments) ? l.attachments : [];
      for (const a of atts) {
        const u =
          (a && (a.url || a.href || a.path || a.filePath || a.file_path || a.src)) || "";
        const s = String(u || "").trim();
        if (!s) continue;

        // فقط مسیرهای لوکال را حذف می‌کنیم
        if (s.startsWith("http://") || s.startsWith("https://")) continue;

        // اگر با / شروع شود یعنی زیر public
        if (s.startsWith("/")) {
          files.add(path.join(pub, s.replace(/^\/+/, "")));
          continue;
        }

        // اگر مثل uploads/... باشد
        if (s.startsWith("uploads/") || s.startsWith("files/")) {
          files.add(path.join(pub, s));
          continue;
        }
      }
    }

    for (const fp of files) {
      try {
        await fs.unlink(fp);
      } catch {
        // اگر نبود یا دسترسی نداشت، بی‌صدا رد شو
      }
    }
  } catch {
    // بی‌صدا
  }
}

export async function GET(req, ctx) {
  try {
    const slug = ctx?.params?.slug || [];
    const p0 = slug[0] || "";

    // ✅ prefs
    if (p0 === "prefs") {
      const userId = await getUserIdFromReq(req);
      if (!userId) return bad("unauthorized", 401);

      const prefs = await prisma.userLetterPrefs.findUnique({
        where: { userId },
      });

      // اگر نداریم، خالی برگردون
      if (!prefs) {
        return json({
          prefs: toSnakePrefs({
            userId,
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

    if (p0 === "next-code") {
      const userId = await getUserIdFromReq(req);
      if (!userId) return bad("unauthorized", 401);

      let url;
      try {
        url = new URL(req.url);
      } catch {
        url = new URL(req.url, "http://localhost");
      }

      const projectId = parseOptionalId(
        url.searchParams.get("project_id") ?? url.searchParams.get("projectId")
      );
      if (projectId === undefined) return bad("invalid_project_id");

      const code = await computeNextLetterCodeFromDb(projectId);
      return json({ code: code || "" });
    }

    if (p0 === "mine") {
      const viewer = await getViewerAccessInfo(req);
      if (!viewer.userId) return bad("unauthorized", 401);
      let itemsRaw = [];

      if (viewer.isMainAdmin) {
        itemsRaw = await listLetters({ createdBy: null });
      } else {
        const mineAndPublic = await listLetters({
          createdBy: String(viewer.userId),
          includePublic: true,
        });

        if (viewer.canSeeConfidential) {
          const allItems = await listLetters({ createdBy: null });
          const merged = new Map(
            mineAndPublic.map((it) => [String(it?.id ?? ""), it])
          );
          allItems
            .filter((it) => isConfidentialLabel(
              it?.classification ??
              it?.classification_label ??
              it?.confidentiality ??
              it?.doc_classification ??
              ""
            ))
            .forEach((it) => merged.set(String(it?.id ?? ""), it));
          itemsRaw = Array.from(merged.values());
        } else {
          itemsRaw = mineAndPublic;
        }
      }

      const items = itemsRaw.filter((it) => canViewConfidentialLetter(it, viewer.canSeeConfidential));
      return json({ items });
    }

    if (p0 && /^\d+$/.test(String(p0))) {
      const id = Number(p0);
      const viewer = await getViewerAccessInfo(req);
      const l = await safeLetterFindUnique({
        where: { id },
      });
      if (!l) return bad("not_found", 404);
      const item = toSnakeLetter(l);
      if (!canViewConfidentialLetter(item, viewer.canSeeConfidential)) {
        return bad("not_found", 404);
      }
      return json({ item });
    }

    const viewer = await getViewerAccessInfo(req);
    const items = (await listLetters({ createdBy: null })).filter((it) =>
      canViewConfidentialLetter(it, viewer.canSeeConfidential)
    );
    return json({ items });
  } catch (e) {
    return bad(e?.message || "request_failed", 500);
  }
}

export async function POST(req, ctx) {
  try {
    const slug = ctx?.params?.slug || [];
    const p0 = slug[0] || "";

    // ✅ allow POST /api/letters/prefs as well
    if (p0 === "prefs") {
      const userId = await getUserIdFromReq(req);
      if (!userId) return bad("unauthorized", 401);

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
        where: { userId },
        create: { userId, ...patch },
        update: { ...patch },
      });

      return json({ prefs: toSnakePrefs(updated) }, 201);
    }

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
        return bad("missing_data");
      }
    }

    if (!hasMeaningfulLetterPayload(payload)) return bad("empty_letter_payload");

    const userId = await getUserIdFromReq(req);
    const resolvedClassification = await resolveClassificationState({
      classificationId: payload.classificationId,
      classificationText: payload.classificationText,
      keepUndefined: false,
    });
    const resolvedSecretariatNo = await resolveSecretariatNoForCreate(payload);
    const resolvedLetterNo = String(resolvedSecretariatNo || payload.letterNo || "").trim();

    const created = await safeLetterCreate({
      kind: payload.kind,

      docClass: payload.docClass ? String(payload.docClass) : null,
      classificationLabel: resolvedClassification.classificationLabel ?? null,
      classificationId: resolvedClassification.classificationId ?? null,

      category: payload.category || null,
      projectId: payload.projectId ?? null,
      internalUnitId: payload.internalUnitId ?? null,
      letterNo: resolvedLetterNo || null,
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
      secretariatNo: resolvedSecretariatNo || null,
      secretariatNote: payload.secretariatNote || null,
      receiverName: payload.receiverName || null,
      attachments: payload.attachments ?? [],

      createdBy: userId ? String(userId) : null,
    });

    return json({ item: toSnakeLetter(created) }, 201);
  } catch (e) {
    if (e?.message === "invalid_json") return bad("invalid_json");
    return bad(e?.message || "request_failed", 500);
  }
}

export async function PATCH(req, ctx) {
  try {
    const slug = ctx?.params?.slug || [];
    const p0 = slug[0] || "";

    // ✅ prefs
    if (p0 === "prefs") {
      const userId = await getUserIdFromReq(req);
      if (!userId) return bad("unauthorized", 401);

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
        where: { userId },
        create: { userId, ...patch },
        update: { ...patch },
      });

      return json({ prefs: toSnakePrefs(updated) });
    }

    // ✅ یک بار body رو بخون
    const raw = await readJsonSafely(req);

    // ✅ id را از مسیر/کوئری/بدنه دربیار
    let id = getIdFromReq(req, ctx);

    if (!id) {
      const idMaybe =
        raw?.id ??
        raw?.letter_id ??
        raw?.letterId ??
        raw?.letterID ??
        raw?.letter?.id ??
        null;

      if (idMaybe != null && /^\d+$/.test(String(idMaybe))) {
        id = Number(idMaybe);
      }
    }

    if (!id) return bad("missing_id");

    const body = normalizePatchPayload(raw);

    if (body.__invalid_project_id) return bad("invalid_project_id");
    if (body.__invalid_internal_unit_id) return bad("invalid_internal_unit_id");
    if (body.__invalid_classification_id) return bad("invalid_classification_id");
    if (body.__invalid_return_to_ids) return bad("invalid_return_to_ids");
    if (body.__invalid_piro_ids) return bad("invalid_piro_ids");
    if (body.__invalid_tag_ids) return bad("invalid_tag_ids");
    if (body.__invalid_attachments) return bad("invalid_attachments");

    const existing = await safeLetterFindUnique({
      where: { id },
    });
    if (!existing) return bad("not_found", 404);

    const resolvedClassification = await resolveClassificationState({
      classificationId: hasOwn(body, "classificationId") ? body.classificationId : undefined,
      classificationText: hasOwn(body, "classificationText") ? body.classificationText : undefined,
      keepUndefined: true,
    });

    const data = {};

    if (hasOwn(body, "kind")) data.kind = body.kind;

    if (hasOwn(body, "docClass"))
      data.docClass = body.docClass === "" ? null : (body.docClass ?? existing.docClass);

    if (resolvedClassification.classificationId !== undefined)
      data.classificationId = resolvedClassification.classificationId;

    if (resolvedClassification.classificationLabel !== undefined)
      data.classificationLabel = resolvedClassification.classificationLabel;

    if (hasOwn(body, "category"))
      data.category = body.category === "" ? null : (body.category ?? existing.category);

    if (hasOwn(body, "projectId"))
      data.projectId = body.projectId;

    if (hasOwn(body, "internalUnitId"))
      data.internalUnitId = body.internalUnitId;

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

    if (hasOwn(body, "hasAttachment"))
      data.hasAttachment = body.hasAttachment;

    if (hasOwn(body, "attachmentTitle"))
      data.attachmentTitle =
        body.attachmentTitle === "" ? null : (body.attachmentTitle ?? existing.attachmentTitle);

    if (hasOwn(body, "returnToIds"))
      data.returnToIds = body.returnToIds;

    if (hasOwn(body, "piroIds"))
      data.piroIds = body.piroIds;

    if (hasOwn(body, "tagIds"))
      data.tagIds = body.tagIds;

    if (hasOwn(body, "secretariatDate"))
      data.secretariatDate =
        body.secretariatDate === "" ? null : (body.secretariatDate ?? existing.secretariatDate);

    if (hasOwn(body, "secretariatNo"))
      data.secretariatNo =
        body.secretariatNo === "" ? null : (body.secretariatNo ?? existing.secretariatNo);

    if (hasOwn(body, "secretariatNo") && !hasOwn(body, "letterNo")) {
      data.letterNo = data.secretariatNo;
    }

    if (hasOwn(body, "secretariatNote"))
      data.secretariatNote =
        body.secretariatNote === "" ? null : (body.secretariatNote ?? existing.secretariatNote);

    if (hasOwn(body, "receiverName"))
      data.receiverName =
        body.receiverName === "" ? null : (body.receiverName ?? existing.receiverName);

    if (hasOwn(body, "attachments"))
      data.attachments = body.attachments;

    if (Object.keys(data).length === 0) {
      return json({ item: toSnakeLetter(existing) });
    }

    const updated = await safeLetterUpdate(id, data);

    return json({ item: toSnakeLetter(updated) });
  } catch (e) {
    if (e?.message === "invalid_json") return bad("invalid_json");
    return bad(e?.message || "request_failed", 500);
  }
}

export async function DELETE(req, ctx) {
  try {
    const slug = ctx?.params?.slug || [];
    const p0 = slug[0] || "";

    // ✅ حذف همه نامه‌ها + فایل‌های ضمیمه
    // مسیر: DELETE /api/letters/all
    if (p0 === "all") {
      const userId = await getUserIdFromReq(req);
      if (!userId) return bad("unauthorized", 401);

      const letters = await prisma.letter.findMany({
        select: { id: true, attachments: true },
        orderBy: { id: "desc" },
      });

      await tryDeleteAttachmentFiles(letters);

      const r = await prisma.letter.deleteMany({});
      return json({ ok: true, deleted: r.count });
    }

    const id = getIdFromReq(req, ctx);
    if (!id) return bad("missing_id");

    // ✅ قبل از حذف تکی، فایل‌های ضمیمه‌اش را هم پاک کن
    const l = await prisma.letter.findUnique({
      where: { id },
      select: { id: true, attachments: true },
    });
    if (l) await tryDeleteAttachmentFiles([l]);

    await prisma.letter.delete({ where: { id } });

    return json({ ok: true });
  } catch (e) {
    if (e?.code === "P2025") return bad("not_found", 404);
    return bad(e?.message || "request_failed", 500);
  }
}
