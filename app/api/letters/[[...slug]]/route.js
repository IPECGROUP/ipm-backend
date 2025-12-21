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

function toSnakeLetter(l) {
  if (!l) return null;
  return {
    id: l.id,
    kind: l.kind,
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
  const kind = kindRaw.includes("out") ? "outgoing" : kindRaw.includes("in") ? "incoming" : (b.kind ? String(b.kind) : "incoming");

  const projectIdVal = b.projectId ?? b.project_id ?? null;
  const projectId = projectIdVal === "" || projectIdVal == null ? null : Number(projectIdVal);

  const hasAttachment = !!(b.hasAttachment ?? b.has_attachment);

  const attachments = Array.isArray(b.attachments) ? b.attachments : [];

  return {
    kind,
    category: b.category ?? "",
    projectId: Number.isFinite(projectId) ? projectId : null,
    letterNo: b.letterNo ?? b.letter_no ?? "",
    letterDate: b.letterDate ?? b.letter_date ?? "",
    fromName: b.fromName ?? b.from_name ?? "",
    toName: b.toName ?? b.to_name ?? "",
    orgName: b.orgName ?? b.org_name ?? "",
    subject: b.subject ?? "",
    hasAttachment,
    attachmentTitle: b.attachmentTitle ?? b.attachment_title ?? "",
    returnToIds: b.returnToIds ?? b.return_to_ids ?? [],
    piroIds: b.piroIds ?? b.piro_ids ?? [],
    tagIds: b.tagIds ?? b.tag_ids ?? [],
    secretariatDate: b.secretariatDate ?? b.secretariat_date ?? "",
    secretariatNo: b.secretariatNo ?? b.secretariat_no ?? "",
    receiverName: b.receiverName ?? b.receiver_name ?? "",
    attachments,
  };
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

async function listLetters({ mineOnly = false }) {
  const where = mineOnly ? {} : {};
  const items = await prisma.letter.findMany({
    where,
    orderBy: { id: "desc" },
  });
  return items.map(toSnakeLetter);
}

export async function GET(req, ctx) {
  try {
    const slug = ctx?.params?.slug || [];
    const p0 = slug[0] || "";

    if (p0 === "mine") {
      const items = await listLetters({ mineOnly: true });
      return json({ items });
    }

    if (p0 && /^\d+$/.test(String(p0))) {
      const id = Number(p0);
      const l = await prisma.letter.findUnique({ where: { id } });
      if (!l) return bad("not_found", 404);
      return json({ item: toSnakeLetter(l) });
    }

    const items = await listLetters({ mineOnly: false });
    return json({ items });
  } catch (e) {
    return bad(e?.message || "request_failed", 500);
  }
}

export async function POST(req) {
  try {
    const ct = req.headers.get("content-type") || "";
    let payload = {};

    if (ct.includes("application/json")) {
      payload = normalizeIncomingPayload(await readJsonSafely(req));
    } else {
      // optional: allow multipart that contains field "data" (json)
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

    const created = await prisma.letter.create({
      data: {
        kind: payload.kind,
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
        createdBy: null,
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
    const idRaw = slug[0];
    if (!idRaw || !/^\d+$/.test(String(idRaw))) return bad("missing_id");
    const id = Number(idRaw);

    const body = normalizeIncomingPayload(await readJsonSafely(req));

    const existing = await prisma.letter.findUnique({ where: { id } });
    if (!existing) return bad("not_found", 404);

    const updated = await prisma.letter.update({
      where: { id },
      data: {
        kind: body.kind ?? existing.kind,
        category: body.category === "" ? null : (body.category ?? existing.category),
        projectId: body.projectId ?? existing.projectId,
        letterNo: body.letterNo === "" ? null : (body.letterNo ?? existing.letterNo),
        letterDate: body.letterDate === "" ? null : (body.letterDate ?? existing.letterDate),
        fromName: body.fromName === "" ? null : (body.fromName ?? existing.fromName),
        toName: body.toName === "" ? null : (body.toName ?? existing.toName),
        orgName: body.orgName === "" ? null : (body.orgName ?? existing.orgName),
        subject: body.subject === "" ? null : (body.subject ?? existing.subject),
        hasAttachment: typeof body.hasAttachment === "boolean" ? body.hasAttachment : existing.hasAttachment,
        attachmentTitle: body.attachmentTitle === "" ? null : (body.attachmentTitle ?? existing.attachmentTitle),
        returnToIds: body.returnToIds ?? existing.returnToIds ?? [],
        piroIds: body.piroIds ?? existing.piroIds ?? [],
        tagIds: body.tagIds ?? existing.tagIds ?? [],
        secretariatDate: body.secretariatDate === "" ? null : (body.secretariatDate ?? existing.secretariatDate),
        secretariatNo: body.secretariatNo === "" ? null : (body.secretariatNo ?? existing.secretariatNo),
        receiverName: body.receiverName === "" ? null : (body.receiverName ?? existing.receiverName),
        attachments: Array.isArray(body.attachments) ? body.attachments : (existing.attachments ?? []),
      },
    });

    return json({ item: toSnakeLetter(updated) });
  } catch (e) {
    return bad(e?.message || "request_failed", 500);
  }
}

export async function DELETE(req, ctx) {
  try {
    const slug = ctx?.params?.slug || [];
    const idRaw = slug[0];
    if (!idRaw || !/^\d+$/.test(String(idRaw))) return bad("missing_id");
    const id = Number(idRaw);

    const existing = await prisma.letter.findUnique({ where: { id } });
    if (!existing) return bad("not_found", 404);

    await prisma.letter.delete({ where: { id } });

    return json({ ok: true });
  } catch (e) {
    return bad(e?.message || "request_failed", 500);
  }
}
