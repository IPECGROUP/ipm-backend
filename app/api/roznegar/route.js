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

async function readJsonSafely(req) {
  const txt = await req.text();
  if (!txt) return {};
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error("invalid_json");
  }
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

function parseBool(v, def = false) {
  if (v === undefined || v === null) return def;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return def;
}

function parseOptionalDate(v) {
  if (v == null || v === "") return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function toStringArray(v) {
  return (Array.isArray(v) ? v : [])
    .map((x) => String(x ?? "").trim())
    .filter(Boolean);
}

function normalizeFiles(v) {
  return (Array.isArray(v) ? v : [])
    .map((f) => ({
      name: String(f?.name || "").trim(),
      size: Number(f?.size || 0) || 0,
      type: String(f?.type || "").trim(),
      url: String(f?.url || "").trim() || null,
      lastModified: Number(f?.lastModified || 0) || 0,
    }))
    .filter((f) => f.name);
}

function validDateYmd(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim());
}

function mapEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    project_id: row.projectId,
    user_id: row.userId,
    date_ymd: row.dateYmd,
    day_name: row.dayName,
    activity: row.activity || "",
    tag_ids: Array.isArray(row.tagIds) ? row.tagIds : [],
    related_doc_ids: Array.isArray(row.relatedDocIds) ? row.relatedDocIds : [],
    files: Array.isArray(row.files) ? row.files : [],
    confirmed: !!row.confirmed,
    confirmed_at: row.confirmedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function GET(req) {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return bad("unauthorized", 401);

    const url = new URL(req.url);
    const projectId = Number(url.searchParams.get("projectId") || url.searchParams.get("project_id") || "");
    const dateYmd = String(url.searchParams.get("dateYmd") || url.searchParams.get("date_ymd") || "").trim();
    const confirmedParam = url.searchParams.get("confirmed");

    if (!Number.isFinite(projectId) || projectId <= 0) return bad("invalid_project_id");
    if (dateYmd && !validDateYmd(dateYmd)) return bad("invalid_date_ymd");

    const where = {
      userId,
      projectId,
      ...(dateYmd ? { dateYmd } : {}),
      ...(confirmedParam != null ? { confirmed: parseBool(confirmedParam, false) } : {}),
    };

    const items = await prisma.roznegarEntry.findMany({
      where,
      orderBy: [{ dateYmd: "desc" }, { id: "desc" }],
    });

    return json({ items: items.map(mapEntry) });
  } catch (e) {
    return bad(e?.message || "request_failed", 500);
  }
}

export async function POST(req) {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return bad("unauthorized", 401);

    const b = await readJsonSafely(req);
    const projectId = Number(b.projectId ?? b.project_id);
    const dateYmd = String(b.dateYmd ?? b.date_ymd ?? "").trim();
    const dayName = String(b.dayName ?? b.day_name ?? "").trim();
    const activity = String(b.activity ?? "").trim();
    const tagIds = toStringArray(b.tagIds ?? b.tag_ids);
    const relatedDocIds = toStringArray(b.relatedDocIds ?? b.related_doc_ids);
    const files = normalizeFiles(b.files);
    const confirmed = parseBool(b.confirmed, false);
    const confirmedAt = parseOptionalDate(b.confirmedAt ?? b.confirmed_at);

    if (!Number.isFinite(projectId) || projectId <= 0) return bad("invalid_project_id");
    if (!validDateYmd(dateYmd)) return bad("invalid_date_ymd");
    if (!dayName) return bad("day_name_required");

    const item = await prisma.roznegarEntry.upsert({
      where: { projectId_userId_dateYmd: { projectId, userId, dateYmd } },
      create: {
        projectId,
        userId,
        dateYmd,
        dayName,
        activity: activity || null,
        tagIds,
        relatedDocIds,
        files,
        confirmed,
        confirmedAt: confirmed ? confirmedAt || new Date() : null,
      },
      update: {
        dayName,
        activity: activity || null,
        tagIds,
        relatedDocIds,
        files,
        confirmed,
        confirmedAt: confirmed ? confirmedAt || new Date() : null,
      },
    });

    return json({ item: mapEntry(item) }, 201);
  } catch (e) {
    if (e?.message === "invalid_json") return bad("invalid_json");
    return bad(e?.message || "request_failed", 500);
  }
}

export async function PATCH(req) {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return bad("unauthorized", 401);

    const b = await readJsonSafely(req);
    const id = Number(b.id);
    if (!Number.isFinite(id) || id <= 0) return bad("invalid_id");

    const data = {};
    if (b.dayName !== undefined || b.day_name !== undefined) data.dayName = String(b.dayName ?? b.day_name ?? "").trim();
    if (b.activity !== undefined) data.activity = String(b.activity || "").trim() || null;
    if (b.tagIds !== undefined || b.tag_ids !== undefined) data.tagIds = toStringArray(b.tagIds ?? b.tag_ids);
    if (b.relatedDocIds !== undefined || b.related_doc_ids !== undefined) data.relatedDocIds = toStringArray(b.relatedDocIds ?? b.related_doc_ids);
    if (b.files !== undefined) data.files = normalizeFiles(b.files);
    if (b.confirmed !== undefined) data.confirmed = parseBool(b.confirmed, false);
    if (b.confirmedAt !== undefined || b.confirmed_at !== undefined) {
      data.confirmedAt = parseOptionalDate(b.confirmedAt ?? b.confirmed_at);
    }

    const exists = await prisma.roznegarEntry.findFirst({ where: { id, userId }, select: { id: true } });
    if (!exists) return bad("not_found", 404);

    const item = await prisma.roznegarEntry.update({
      where: { id },
      data,
    });

    return json({ item: mapEntry(item) });
  } catch (e) {
    if (e?.message === "invalid_json") return bad("invalid_json");
    return bad(e?.message || "request_failed", 500);
  }
}

export async function DELETE(req) {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return bad("unauthorized", 401);

    const url = new URL(req.url);
    const id = Number(url.searchParams.get("id") || "");
    if (!Number.isFinite(id) || id <= 0) return bad("invalid_id");

    const exists = await prisma.roznegarEntry.findFirst({ where: { id, userId }, select: { id: true } });
    if (!exists) return bad("not_found", 404);

    await prisma.roznegarEntry.delete({ where: { id } });
    return json({ ok: true });
  } catch (e) {
    return bad(e?.message || "request_failed", 500);
  }
}
