import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const ALLOWED_KINDS = new Set([
  "office",
  "site",
  "finance",
  "cash",
  "capex",
  "projects",
]);

const json = (data, status = 200) => NextResponse.json(data, { status });

function slugFromReq(req) {
  try {
    const u = new URL(req.url);
    const parts = u.pathname.split("/").filter(Boolean);
    const i = parts.indexOf("centers");
    if (i === -1) return [];
    return parts.slice(i + 1);
  } catch {
    return [];
  }
}

function getSlugArray(req, params) {
  const raw = params?.slug;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw) return [raw];
  return slugFromReq(req);
}

function parseParams(req, params) {
  const slug = getSlugArray(req, params);
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

function normalizeCenterLike(x) {
  const code = String(x?.code ?? x?.suffix ?? "").trim();
  const name = String(x?.name ?? x?.description ?? "").trim();

  return {
    ...x,
    code,
    name,
    center_desc: x?.center_desc ?? name,
    last_amount: Number(x?.last_amount || 0),
  };
}

function mapProjectToCenterLike(p) {
  return normalizeCenterLike({
    id: p?.id,
    kind: "projects",
    suffix: String(p?.code ?? ""),
    description: String(p?.name ?? ""),
    createdAt: p?.createdAt ?? null,
    updatedAt: p?.updatedAt ?? null,
  });
}

export async function GET(req, ctx) {
  const { kind, id, idInvalid } = parseParams(req, ctx?.params);
  if (!kind) return json({ error: "invalid_kind" }, 400);
  if (idInvalid) return json({ error: "invalid_id" }, 400);

  try {
    if (kind === "projects") {
      if (id) {
        const p = await prisma.project.findUnique({ where: { id } });
        if (!p) return json({ error: "not_found" }, 404);
        return json({ item: mapProjectToCenterLike(p) });
      }

      const items = await prisma.project.findMany({
        orderBy: [{ code: "asc" }],
      });

      return json({ items: (items || []).map(mapProjectToCenterLike) });
    }

    if (id) {
      const item = await prisma.center.findUnique({ where: { id } });
      if (!item || item.kind !== kind) return json({ error: "not_found" }, 404);
      return json({ item: normalizeCenterLike(item) });
    }

    const items = await prisma.center.findMany({
      where: { kind },
      orderBy: [{ suffix: "asc" }],
    });

    return json({ items: (items || []).map(normalizeCenterLike) });
  } catch (e) {
    return json(
      { error: "centers_get_error", message: String(e?.message || e) },
      500
    );
  }
}

export async function POST(req, ctx) {
  const { kind, id, idInvalid } = parseParams(req, ctx?.params);
  if (!kind) return json({ error: "invalid_kind" }, 400);
  if (idInvalid) return json({ error: "invalid_id" }, 400);
  if (id) return json({ error: "bad_route" }, 400);

  const body = await readJson(req);
  const suffix = String(body?.suffix ?? body?.code ?? "").trim();
  const description = String(body?.description ?? body?.name ?? "").trim();

  if (!suffix) return json({ error: "suffix_required" }, 400);

  try {
    if (kind === "projects") {
      const dup = await prisma.project.findFirst({ where: { code: suffix } });
      if (dup) return json({ error: "duplicate_suffix" }, 409);

      const item = await prisma.project.create({
        data: { code: suffix, name: description || suffix },
      });

      return json({ ok: true, item: mapProjectToCenterLike(item) }, 201);
    }

    const dup = await prisma.center.findFirst({ where: { kind, suffix } });
    if (dup) return json({ error: "duplicate_suffix" }, 409);

    const item = await prisma.center.create({
      data: { kind, suffix, description },
    });

    return json({ ok: true, item: normalizeCenterLike(item) }, 201);
  } catch (e) {
    return json(
      { error: "centers_post_error", message: String(e?.message || e) },
      500
    );
  }
}

export async function PATCH(req, ctx) {
  const { kind, id, idInvalid } = parseParams(req, ctx?.params);
  if (!kind) return json({ error: "invalid_kind" }, 400);
  if (idInvalid || !id) return json({ error: "invalid_id" }, 400);

  const body = await readJson(req);
  const suffix = String(body?.suffix ?? body?.code ?? "").trim();
  const description = String(body?.description ?? body?.name ?? "").trim();

  if (!suffix) return json({ error: "suffix_required" }, 400);

  try {
    if (kind === "projects") {
      const cur = await prisma.project.findUnique({ where: { id } });
      if (!cur) return json({ error: "not_found" }, 404);

      const dup = await prisma.project.findFirst({
        where: { code: suffix, NOT: { id } },
      });
      if (dup) return json({ error: "duplicate_suffix" }, 409);

      const item = await prisma.project.update({
        where: { id },
        data: { code: suffix, name: description || suffix },
      });

      return json({ ok: true, item: mapProjectToCenterLike(item) });
    }

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

    return json({ ok: true, item: normalizeCenterLike(item) });
  } catch (e) {
    return json(
      { error: "centers_patch_error", message: String(e?.message || e) },
      500
    );
  }
}

export async function DELETE(req, ctx) {
  const { kind, id, idInvalid } = parseParams(req, ctx?.params);
  if (!kind) return json({ error: "invalid_kind" }, 400);
  if (idInvalid || !id) return json({ error: "invalid_id" }, 400);

  try {
    if (kind === "projects") {
      const cur = await prisma.project.findUnique({ where: { id } });
      if (!cur) return json({ error: "not_found" }, 404);
      await prisma.project.delete({ where: { id } });
      return json({ ok: true });
    }

    const cur = await prisma.center.findUnique({ where: { id } });
    if (!cur || cur.kind !== kind) return json({ error: "not_found" }, 404);

    await prisma.center.delete({ where: { id } });
    return json({ ok: true });
  } catch (e) {
    return json(
      { error: "centers_delete_error", message: String(e?.message || e) },
      500
    );
  }
}
