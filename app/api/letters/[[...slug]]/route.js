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

function getUserIdFromReq(req) {
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

async function readJsonSafely(req) {
  const txt = await req.text();
  if (!txt) return {};
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error("invalid_json");
  }
}

function toSnakeLetter(l) {
  if (!l) return null;
  return {
    id: l.id,
    kind: l.kind,

    doc_class: l.docClass ?? "",
    classification_id: l.classificationId ?? null,

    category: l.category ?? "",
    project_id: l.projectId ?? null,

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
    receiver_name: l.receiverName ?? "",
    attachments: l.attachments ?? [],
    created_by: l.createdBy ?? null,
    created_at: l.createdAt,
    updated_at: l.updatedAt,
  };
}

function normalizeIncomingPayload(body) {
  const b = body || {};

  const kindRaw = String(b.kind || b.type || b.direction || "").toLowerCase();
  const kind = kindRaw.includes("out")
    ? "outgoing"
    : kindRaw.includes("in")
      ? "incoming"
      : b.kind
        ? String(b.kind)
        : "incoming";

  const projectIdVal = b.projectId ?? b.project_id ?? null;
  const projectIdParsed = parseOptionalId(projectIdVal);
  const projectId = projectIdParsed === undefined ? null : projectIdParsed;

  const classificationVal =
    b.classificationId ??
    b.classification_id ??
    b.tagCategoryId ??
    b.tag_category_id ??
    b.categoryId ??
    b.category_id ??
    null;
  const classificationParsed = parseOptionalId(classificationVal);
  const classificationId = classificationParsed === undefined ? null : classificationParsed;

  const hasAttachment = !!(b.hasAttachment ?? b.has_attachment);
  const attachments = Array.isArray(b.attachments) ? b.attachments : [];

  return {
    kind,

    docClass: b.docClass ?? b.doc_class ?? "",
    classificationId,

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
    receiverName: b.receiverName ?? b.receiver_name ?? "",
    attachments,
  };
}

function normalizePatchPayload(body) {
  const b = body || {};
  const out = {};

  if (hasOwn(b, "kind") || hasOwn(b, "type") || hasOwn(b, "direction")) {
    const kindRaw = String(b.kind ?? b.type ?? b.direction ?? "").toLowerCase();
    out.kind = kindRaw.includes("out")
      ? "outgoing"
      : kindRaw.includes("in")
        ? "incoming"
        : String(b.kind ?? b.type ?? b.direction ?? "");
  }

  if (hasOwn(b, "docClass") || hasOwn(b, "doc_class")) out.docClass = b.docClass ?? b.doc_class ?? "";

  if (
    hasOwn(b, "classificationId") ||
    hasOwn(b, "classification_id") ||
    hasOwn(b, "tagCategoryId") ||
    hasOwn(b, "tag_category_id") ||
    hasOwn(b, "categoryId") ||
    hasOwn(b, "category_id")
  ) {
    const v =
      b.classificationId ??
      b.classification_id ??
      b.tagCategoryId ??
      b.tag_category_id ??
      b.categoryId ??
      b.category_id;
    const parsed = parseOptionalId(v);
    if (parsed === undefined) out.__invalid_classification_id = true;
    else out.classificationId = parsed;
  }

  if (hasOwn(b, "projectId") || hasOwn(b, "project_id")) {
    const parsed = parseOptionalId(b.projectId ?? b.project_id);
    if (parsed === undefined) out.__invalid_project_id = true;
    else out.projectId = parsed;
  }

  if (hasOwn(b, "hasAttachment") || hasOwn(b, "has_attachment")) {
    out.hasAttachment = !!(b.hasAttachment ?? b.has_attachment);
  }

  if (hasOwn(b, "category")) out.category = b.category ?? "";
  if (hasOwn(b, "letterNo") || hasOwn(b, "letter_no")) out.letterNo = b.letterNo ?? b.letter_no ?? "";
  if (hasOwn(b, "letterDate") || hasOwn(b, "letter_date")) out.letterDate = b.letterDate ?? b.letter_date ?? "";
  if (hasOwn(b, "fromName") || hasOwn(b, "from_name")) out.fromName = b.fromName ?? b.from_name ?? "";
  if (hasOwn(b, "toName") || hasOwn(b, "to_name")) out.toName = b.toName ?? b.to_name ?? "";
  if (hasOwn(b, "orgName") || hasOwn(b, "org_name")) out.orgName = b.orgName ?? b.org_name ?? "";
  if (hasOwn(b, "subject")) out.subject = b.subject ?? "";
  if (hasOwn(b, "attachmentTitle") || hasOwn(b, "attachment_title"))
    out.attachmentTitle = b.attachmentTitle ?? b.attachment_title ?? "";
  if (hasOwn(b, "secretariatDate") || hasOwn(b, "secretariat_date"))
    out.secretariatDate = b.secretariatDate ?? b.secretariat_date ?? "";
  if (hasOwn(b, "secretariatNo") || hasOwn(b, "secretariat_no"))
    out.secretariatNo = b.secretariatNo ?? b.secretariat_no ?? "";
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

async function listLetters({ createdBy = null } = {}) {
  const where = createdBy ? { createdBy: String(createdBy) } : {};
  const items = await prisma.letter.findMany({
    where,
    orderBy: { id: "desc" },
  });
  return items.map(toSnakeLetter);
}

async function ensureValidLettersClassificationId(classificationId) {
  if (classificationId == null) return true;
  const exists = await prisma.tagCategory.findFirst({
    where: { id: classificationId, scope: "letters" },
    select: { id: true },
  });
  return !!exists;
}

function normalizePrefsPayload(body) {
  const b = body || {};
  const out = {};

  const tabs = ["all", "incoming", "outgoing", "internal"];
  for (const t of tabs) {
    const keyTagsCamel = `${t}TagIds`;
    const keyTagsSnake = `${t}_tag_ids`;
    if (hasOwn(b, keyTagsCamel) || hasOwn(b, keyTagsSnake)) {
      const v = b[keyTagsCamel] ?? b[keyTagsSnake];
      if (!Array.isArray(v)) out[`__invalid_${t}_tag_ids`] = true;
      else out[keyTagsCamel] = v;
    }

    const keyClsCamel = `${t}ClassificationId`;
    const keyClsSnake = `${t}_classification_id`;
    if (hasOwn(b, keyClsCamel) || hasOwn(b, keyClsSnake)) {
      const raw = b[keyClsCamel] ?? b[keyClsSnake];
      const parsed = parseOptionalId(raw);
      if (parsed === undefined) out[`__invalid_${t}_classification_id`] = true;
      else out[keyClsCamel] = parsed;
    }
  }

  return out;
}

function toSnakePrefs(p) {
  return {
    all_tag_ids: p?.allTagIds ?? [],
    incoming_tag_ids: p?.incomingTagIds ?? [],
    outgoing_tag_ids: p?.outgoingTagIds ?? [],
    internal_tag_ids: p?.internalTagIds ?? [],
    all_classification_id: p?.allClassificationId ?? null,
    incoming_classification_id: p?.incomingClassificationId ?? null,
    outgoing_classification_id: p?.outgoingClassificationId ?? null,
    internal_classification_id: p?.internalClassificationId ?? null,
    updated_at: p?.updatedAt ?? null,
  };
}

export async function GET(req, ctx) {
  try {
    const slug = ctx?.params?.slug || [];
    const p0 = slug[0] || "";

    if (p0 === "prefs") {
      const userId = getUserIdFromReq(req);
      if (!userId) return bad("unauthorized", 401);

      const prefs = await prisma.userLetterPrefs.findUnique({ where: { userId } });
      return json({ item: toSnakePrefs(prefs) });
    }

    if (p0 === "mine") {
      const userId = getUserIdFromReq(req);
      const items = await listLetters({ createdBy: userId });
      return json({ items });
    }

    if (p0 && /^\d+$/.test(String(p0))) {
      const id = Number(p0);
      const l = await prisma.letter.findUnique({ where: { id } });
      if (!l) return bad("not_found", 404);
      return json({ item: toSnakeLetter(l) });
    }

    const items = await listLetters({ createdBy: null });
    return json({ items });
  } catch (e) {
    return bad(e?.message || "request_failed", 500);
  }
}

export async function POST(req, ctx) {
  try {
    const slug = ctx?.params?.slug || [];
    const p0 = slug[0] || "";

    if (p0 === "prefs") {
      const userId = getUserIdFromReq(req);
      if (!userId) return bad("unauthorized", 401);

      const raw = await readJsonSafely(req);
      const body = normalizePrefsPayload(raw);

      for (const k of Object.keys(body)) {
        if (k.startsWith("__invalid_")) return bad(k.replace(/^__invalid_/, "invalid_"));
      }

      const data = {};
      if (hasOwn(body, "allTagIds")) data.allTagIds = body.allTagIds;
      if (hasOwn(body, "incomingTagIds")) data.incomingTagIds = body.incomingTagIds;
      if (hasOwn(body, "outgoingTagIds")) data.outgoingTagIds = body.outgoingTagIds;
      if (hasOwn(body, "internalTagIds")) data.internalTagIds = body.internalTagIds;

      if (hasOwn(body, "allClassificationId")) data.allClassificationId = body.allClassificationId;
      if (hasOwn(body, "incomingClassificationId")) data.incomingClassificationId = body.incomingClassificationId;
      if (hasOwn(body, "outgoingClassificationId")) data.outgoingClassificationId = body.outgoingClassificationId;
      if (hasOwn(body, "internalClassificationId")) data.internalClassificationId = body.internalClassificationId;

      const saved = await prisma.userLetterPrefs.upsert({
        where: { userId },
        create: {
          userId,
          allTagIds: data.allTagIds ?? [],
          incomingTagIds: data.incomingTagIds ?? [],
          outgoingTagIds: data.outgoingTagIds ?? [],
          internalTagIds: data.internalTagIds ?? [],
          allClassificationId: data.allClassificationId ?? null,
          incomingClassificationId: data.incomingClassificationId ?? null,
          outgoingClassificationId: data.outgoingClassificationId ?? null,
          internalClassificationId: data.internalClassificationId ?? null,
        },
        update: data,
      });

      return json({ item: toSnakePrefs(saved) }, 200);
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
        payload = normalizeIncomingPayload({});
      }
    }

    if (!(await ensureValidLettersClassificationId(payload.classificationId))) {
      return bad("invalid_classification_id");
    }

    const userId = getUserIdFromReq(req);

    const created = await prisma.letter.create({
      data: {
        kind: payload.kind,

        docClass: payload.docClass === "" ? null : payload.docClass,
        classificationId: payload.classificationId ?? null,

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
        receiverName: payload.receiverName || null,
        attachments: payload.attachments ?? [],
        createdBy: userId ? String(userId) : null,
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
    const slug = ctx?.params?.slug || [];
    const p0 = slug[0] || "";

    if (p0 === "prefs") {
      const userId = getUserIdFromReq(req);
      if (!userId) return bad("unauthorized", 401);

      const raw = await readJsonSafely(req);
      const body = normalizePrefsPayload(raw);

      for (const k of Object.keys(body)) {
        if (k.startsWith("__invalid_")) return bad(k.replace(/^__invalid_/, "invalid_"));
      }

      const data = {};
      if (hasOwn(body, "allTagIds")) data.allTagIds = body.allTagIds;
      if (hasOwn(body, "incomingTagIds")) data.incomingTagIds = body.incomingTagIds;
      if (hasOwn(body, "outgoingTagIds")) data.outgoingTagIds = body.outgoingTagIds;
      if (hasOwn(body, "internalTagIds")) data.internalTagIds = body.internalTagIds;

      if (hasOwn(body, "allClassificationId")) data.allClassificationId = body.allClassificationId;
      if (hasOwn(body, "incomingClassificationId")) data.incomingClassificationId = body.incomingClassificationId;
      if (hasOwn(body, "outgoingClassificationId")) data.outgoingClassificationId = body.outgoingClassificationId;
      if (hasOwn(body, "internalClassificationId")) data.internalClassificationId = body.internalClassificationId;

      const saved = await prisma.userLetterPrefs.upsert({
        where: { userId },
        create: {
          userId,
          allTagIds: data.allTagIds ?? [],
          incomingTagIds: data.incomingTagIds ?? [],
          outgoingTagIds: data.outgoingTagIds ?? [],
          internalTagIds: data.internalTagIds ?? [],
          allClassificationId: data.allClassificationId ?? null,
          incomingClassificationId: data.incomingClassificationId ?? null,
          outgoingClassificationId: data.outgoingClassificationId ?? null,
          internalClassificationId: data.internalClassificationId ?? null,
        },
        update: data,
      });

      return json({ item: toSnakePrefs(saved) }, 200);
    }

    const idRaw = slug[0];
    if (!idRaw || !/^\d+$/.test(String(idRaw))) return bad("missing_id");
    const id = Number(idRaw);

    const raw = await readJsonSafely(req);
    const body = normalizePatchPayload(raw);

    if (body.__invalid_project_id) return bad("invalid_project_id");
    if (body.__invalid_classification_id) return bad("invalid_classification_id");
    if (body.__invalid_return_to_ids) return bad("invalid_return_to_ids");
    if (body.__invalid_piro_ids) return bad("invalid_piro_ids");
    if (body.__invalid_tag_ids) return bad("invalid_tag_ids");
    if (body.__invalid_attachments) return bad("invalid_attachments");

    const existing = await prisma.letter.findUnique({ where: { id } });
    if (!existing) return bad("not_found", 404);

    const data = {};

    if (hasOwn(body, "kind")) data.kind = body.kind;

    if (hasOwn(body, "docClass")) data.docClass = body.docClass === "" ? null : body.docClass;

    if (hasOwn(body, "classificationId")) {
      if (!(await ensureValidLettersClassificationId(body.classificationId))) {
        return bad("invalid_classification_id");
      }
      data.classificationId = body.classificationId;
    }

    if (hasOwn(body, "category")) data.category = body.category === "" ? null : body.category;

    if (hasOwn(body, "projectId")) data.projectId = body.projectId;

    if (hasOwn(body, "letterNo")) data.letterNo = body.letterNo === "" ? null : body.letterNo;
    if (hasOwn(body, "letterDate")) data.letterDate = body.letterDate === "" ? null : body.letterDate;
    if (hasOwn(body, "fromName")) data.fromName = body.fromName === "" ? null : body.fromName;
    if (hasOwn(body, "toName")) data.toName = body.toName === "" ? null : body.toName;
    if (hasOwn(body, "orgName")) data.orgName = body.orgName === "" ? null : body.orgName;
    if (hasOwn(body, "subject")) data.subject = body.subject === "" ? null : body.subject;

    if (hasOwn(body, "hasAttachment")) data.hasAttachment = body.hasAttachment;

    if (hasOwn(body, "attachmentTitle"))
      data.attachmentTitle = body.attachmentTitle === "" ? null : body.attachmentTitle;

    if (hasOwn(body, "returnToIds")) data.returnToIds = body.returnToIds;
    if (hasOwn(body, "piroIds")) data.piroIds = body.piroIds;
    if (hasOwn(body, "tagIds")) data.tagIds = body.tagIds;

    if (hasOwn(body, "secretariatDate")) data.secretariatDate = body.secretariatDate === "" ? null : body.secretariatDate;
    if (hasOwn(body, "secretariatNo")) data.secretariatNo = body.secretariatNo === "" ? null : body.secretariatNo;
    if (hasOwn(body, "receiverName")) data.receiverName = body.receiverName === "" ? null : body.receiverName;

    if (hasOwn(body, "attachments")) data.attachments = body.attachments;

    if (Object.keys(data).length === 0) return json({ item: toSnakeLetter(existing) });

    const updated = await prisma.letter.update({ where: { id }, data });
    return json({ item: toSnakeLetter(updated) });
  } catch (e) {
    if (e?.message === "invalid_json") return bad("invalid_json");
    return bad(e?.message || "request_failed", 500);
  }
}

export async function DELETE(req, ctx) {
  try {
    const slug = ctx?.params?.slug || [];
    if (slug[0] === "prefs") return bad("method_not_allowed", 405);

    const url = new URL(req.url, "http://localhost");
    let idRaw = slug[0] || url.searchParams.get("id") || url.searchParams.get("letter_id");

    if (!idRaw) {
      const parts = url.pathname.split("/").filter(Boolean);
      for (let i = parts.length - 1; i >= 0; i--) {
        if (/^\d+$/.test(parts[i])) {
          idRaw = parts[i];
          break;
        }
      }
    }

    if (!idRaw || !/^\d+$/.test(String(idRaw))) return bad("missing_id");
    const id = Number(idRaw);

    await prisma.letter.delete({ where: { id } });
    return json({ ok: true });
  } catch (e) {
    if (e?.code === "P2025") return bad("not_found", 404);
    return bad(e?.message || "request_failed", 500);
  }
}
