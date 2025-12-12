import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const ALLOWED_KINDS = new Set(["office", "site", "finance", "cash", "capex", "projects"]);
const json = (data, status = 200) => NextResponse.json(data, { status });

function getSlugArray(params) {
  const raw = params?.slug ?? [];
  if (Array.isArray(raw)) return raw;
  if (raw === undefined || raw === null) return [];
  return [raw];
}

function parseParams(params) {
  const slug = getSlugArray(params);
const kind = decodeURIComponent(String(slug[0] || "")).trim().toLowerCase();
  const idRaw = slug[1];

  if (!ALLOWED_KINDS.has(kind)) return { kind: null, id: null, idInvalid: false };

  let id = null;
  let idInvalid = false;

  if (idRaw !== undefined) {
    const n = Number(idRaw);
    if (!Number.isFinite(n) || n <= 0) idInvalid = true;
    else id = n;
  }

  return { kind, id, idInvalid };
}

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export async function GET(_req, { params }) {
  const { kind, id, idInvalid } = parseParams(params);
if (!kind) return json({ error: "invalid_kind", got: { slug: params?.slug } }, 400);
  if (idInvalid) return json({ error: "invalid_id" }, 400);

  try {
    if (id) {
      const item = await prisma.center.findUnique({ where: { id } });
      if (!item || item.kind !== kind) return json({ error: "not_found" }, 404);
      return json({ item });
    }

    const items = await prisma.center.findMany({
      where: { kind },
      orderBy: [{ suffix: "asc" }],
    });

    return json({ items: items || [] });
  } catch (e) {
    return json({ error: "centers_get_error", message: String(e?.message || e) }, 500);
  }
}

export async function POST(req, { params }) {
  const { kind, id, idInvalid } = parseParams(params);
  if (!kind) return json({ error: "invalid_kind" }, 400);
  if (idInvalid) return json({ error: "invalid_id" }, 400);
  if (id) return json({ error: "bad_route" }, 400);

  const body = await readJson(req);
  const suffix = String(body?.suffix ?? "").trim();
  const description = String(body?.description ?? "").trim();

  if (!suffix) return json({ error: "suffix_required" }, 400);

  try {
    const dup = await prisma.center.findFirst({ where: { kind, suffix } });
    if (dup) return json({ error: "duplicate_suffix" }, 409);

    const item = await prisma.center.create({
      data: { kind, suffix, description },
    });

    return json({ ok: true, item }, 201);
  } catch (e) {
    return json({ error: "centers_post_error", message: String(e?.message || e) }, 500);
  }
}

export async function PATCH(req, { params }) {
  const { kind, id, idInvalid } = parseParams(params);
  if (!kind) return json({ error: "invalid_kind" }, 400);
  if (idInvalid || !id) return json({ error: "invalid_id" }, 400);

  const body = await readJson(req);
  const suffix = String(body?.suffix ?? "").trim();
  const description = String(body?.description ?? "").trim();

  if (!suffix) return json({ error: "suffix_required" }, 400);

  try {
    const cur = await prisma.center.findUnique({ where: { id } });
    if (!cur || cur.kind !== kind) return json({ error: "not_found" }, 404);

    const dup = await prisma.center.findFirst({
      where: { kind, suffix, NOT: { id } },
    });
    if (dup) return json({ error: "duplicate_suffix" }, 409);

    const item = await prisma.center.update({
      where: { id },
      data: { suffix, description },
    });

    return json({ ok: true, item });
  } catch (e) {
    return json({ error: "centers_patch_error", message: String(e?.message || e) }, 500);
  }
}

export async function DELETE(_req, { params }) {
  const { kind, id, idInvalid } = parseParams(params);
  if (!kind) return json({ error: "invalid_kind" }, 400);
  if (idInvalid || !id) return json({ error: "invalid_id" }, 400);

  try {
    const cur = await prisma.center.findUnique({ where: { id } });
    if (!cur || cur.kind !== kind) return json({ error: "not_found" }, 404);

    await prisma.center.delete({ where: { id } });
    return json({ ok: true });
  } catch (e) {
    return json({ error: "centers_delete_error", message: String(e?.message || e) }, 500);
  }
}
