// app/api/admin/unit-access/[[...id]]/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "../../../../../lib/prisma";

function pickIdFromParams(params) {
  const raw = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pickIdFromUrl(request) {
  try {
    const { pathname } = new URL(request.url);
    const parts = pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (!last || last === "unit-access") return null;
    const n = Number(last);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function toBoolPermitted(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (v === 1 || v === "1" || v === "true") return true;
  if (v === 0 || v === "0" || v === "false") return false;
  return true;
}

function toIntPermitted(v) {
  return v ? 1 : 0;
}

function mapRow(r) {
  return {
    id: r.id,
    unitId: r.unitId,
    page: r.page,
    tab: r.tab,
    permitted: toIntPermitted(r.permitted),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function normalizeTabInput(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.toLowerCase() === "null") return null;
  return s;
}

// GET /api/admin/unit-access?unit_id=1
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const unitId = Number(url.searchParams.get("unit_id") || 0);

    if (!unitId) {
      return new Response(JSON.stringify({ error: "unit_id_required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rows = await prisma.unitAccessRule.findMany({
      where: { unitId },
      orderBy: { id: "asc" },
    });

    return Response.json({ items: (rows || []).map(mapRow) });
  } catch (e) {
    console.error("unit_access_get_error", e);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// POST /api/admin/unit-access
export async function POST(request) {
  try {
    const body = await request.json();

    const unitId = Number(body.unit_id ?? body.unitId ?? 0);
    const page = String(body.page || "").trim();
    const tab = normalizeTabInput(body.tab);
    const permitted = toBoolPermitted(body.permitted);

    if (!unitId) {
      return new Response(JSON.stringify({ error: "unit_id_required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!page) {
      return new Response(JSON.stringify({ error: "page_required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const whereDelete =
      tab === null
        ? { unitId, page }
        : {
            unitId,
            page,
            OR: [{ tab }, { tab: null }, { tab: "" }, { tab: "null" }, { tab: "NULL" }],
          };

    await prisma.unitAccessRule.deleteMany({ where: whereDelete });

    const item = await prisma.unitAccessRule.create({
      data: { unitId, page, tab, permitted },
    });

    return Response.json({ ok: true, item: mapRow(item) });
  } catch (e) {
    console.error("unit_access_post_error", e);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// DELETE /api/admin/unit-access/:id
// + DELETE /api/admin/unit-access?unit_id=1[&page=DefineBudgetCentersPage]
export async function DELETE(request, { params }) {
  try {
    const id = pickIdFromParams(params) ?? pickIdFromUrl(request);

    if (!id) {
      const url = new URL(request.url);
      const unitId = Number(url.searchParams.get("unit_id") || 0);
      const page = url.searchParams.get("page");
      const tab = url.searchParams.get("tab");

      if (!unitId) {
        return new Response(JSON.stringify({ error: "unit_id_required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const where = {
        unitId,
        ...(page ? { page: String(page).trim() } : {}),
        ...(tab !== null && tab !== undefined && tab !== "" ? { tab: String(tab).trim() } : {}),
      };

      const r = await prisma.unitAccessRule.deleteMany({ where });
      return Response.json({ ok: true, deleted: r.count });
    }

    const item = await prisma.unitAccessRule.delete({ where: { id } });
    return Response.json({ ok: true, item: mapRow(item) });
  } catch (e) {
    console.error("unit_access_delete_error", e);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
