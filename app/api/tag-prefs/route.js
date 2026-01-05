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

function toSnakePrefs(p) {
  const x = p || {};
  return {
    user_id: x.userId ?? null,
    all_tag_ids: x.allTagIds ?? [],
    incoming_tag_ids: x.incomingTagIds ?? [],
    outgoing_tag_ids: x.outgoingTagIds ?? [],
    internal_tag_ids: x.internalTagIds ?? [],
    all_classification_id: x.allClassificationId ?? null,
    incoming_classification_id: x.incomingClassificationId ?? null,
    outgoing_classification_id: x.outgoingClassificationId ?? null,
    internal_classification_id: x.internalClassificationId ?? null,
    created_at: x.createdAt ?? null,
    updated_at: x.updatedAt ?? null,
  };
}

function normalizePrefsPayload(body) {
  const b = body || {};

  // accept snake_case and camelCase
  const allTagIds = ensureArray(b.allTagIds ?? b.all_tag_ids);
  const incomingTagIds = ensureArray(b.incomingTagIds ?? b.incoming_tag_ids);
  const outgoingTagIds = ensureArray(b.outgoingTagIds ?? b.outgoing_tag_ids);
  const internalTagIds = ensureArray(b.internalTagIds ?? b.internal_tag_ids);

  const allClassificationId = parseOptionalId(b.allClassificationId ?? b.all_classification_id);
  const incomingClassificationId = parseOptionalId(b.incomingClassificationId ?? b.incoming_classification_id);
  const outgoingClassificationId = parseOptionalId(b.outgoingClassificationId ?? b.outgoing_classification_id);
  const internalClassificationId = parseOptionalId(b.internalClassificationId ?? b.internal_classification_id);

  if (
    allClassificationId === undefined ||
    incomingClassificationId === undefined ||
    outgoingClassificationId === undefined ||
    internalClassificationId === undefined
  ) {
    return { __invalid_classification_id: true };
  }

  return {
    allTagIds,
    incomingTagIds,
    outgoingTagIds,
    internalTagIds,
    allClassificationId,
    incomingClassificationId,
    outgoingClassificationId,
    internalClassificationId,
  };
}

export async function GET(req) {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return bad("unauthorized", 401);

    // front may send scope=letters_filter; we accept it but it's not needed in DB
    // const url = new URL(req.url);
    // const scope = url.searchParams.get("scope") || "";

    const prefs = await prisma.userLetterPrefs.findUnique({
      where: { userId },
    });

    if (!prefs) {
      return json({ item: toSnakePrefs({ userId }) });
    }

    return json({ item: toSnakePrefs(prefs) });
  } catch (e) {
    return bad(e?.message || "request_failed", 500);
  }
}

export async function POST(req) {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return bad("unauthorized", 401);

    const raw = await readJsonSafely(req);
    const body = normalizePrefsPayload(raw);
    if (body.__invalid_classification_id) return bad("invalid_classification_id");

    const upserted = await prisma.userLetterPrefs.upsert({
      where: { userId },
      create: {
        userId,
        allTagIds: body.allTagIds ?? [],
        incomingTagIds: body.incomingTagIds ?? [],
        outgoingTagIds: body.outgoingTagIds ?? [],
        internalTagIds: body.internalTagIds ?? [],
        allClassificationId: body.allClassificationId ?? null,
        incomingClassificationId: body.incomingClassificationId ?? null,
        outgoingClassificationId: body.outgoingClassificationId ?? null,
        internalClassificationId: body.internalClassificationId ?? null,
      },
      update: {
        allTagIds: body.allTagIds ?? [],
        incomingTagIds: body.incomingTagIds ?? [],
        outgoingTagIds: body.outgoingTagIds ?? [],
        internalTagIds: body.internalTagIds ?? [],
        allClassificationId: body.allClassificationId ?? null,
        incomingClassificationId: body.incomingClassificationId ?? null,
        outgoingClassificationId: body.outgoingClassificationId ?? null,
        internalClassificationId: body.internalClassificationId ?? null,
      },
    });

    return json({ item: toSnakePrefs(upserted) }, 201);
  } catch (e) {
    if (e?.message === "invalid_json") return bad("invalid_json");
    return bad(e?.message || "request_failed", 500);
  }
}

export async function PATCH(req) {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return bad("unauthorized", 401);

    const raw = await readJsonSafely(req);
    const body = normalizePrefsPayload(raw);
    if (body.__invalid_classification_id) return bad("invalid_classification_id");

    const upserted = await prisma.userLetterPrefs.upsert({
      where: { userId },
      create: {
        userId,
        allTagIds: body.allTagIds ?? [],
        incomingTagIds: body.incomingTagIds ?? [],
        outgoingTagIds: body.outgoingTagIds ?? [],
        internalTagIds: body.internalTagIds ?? [],
        allClassificationId: body.allClassificationId ?? null,
        incomingClassificationId: body.incomingClassificationId ?? null,
        outgoingClassificationId: body.outgoingClassificationId ?? null,
        internalClassificationId: body.internalClassificationId ?? null,
      },
      update: {
        allTagIds: body.allTagIds ?? [],
        incomingTagIds: body.incomingTagIds ?? [],
        outgoingTagIds: body.outgoingTagIds ?? [],
        internalTagIds: body.internalTagIds ?? [],
        allClassificationId: body.allClassificationId ?? null,
        incomingClassificationId: body.incomingClassificationId ?? null,
        outgoingClassificationId: body.outgoingClassificationId ?? null,
        internalClassificationId: body.internalClassificationId ?? null,
      },
    });

    return json({ item: toSnakePrefs(upserted) });
  } catch (e) {
    if (e?.message === "invalid_json") return bad("invalid_json");
    return bad(e?.message || "request_failed", 500);
  }
}
