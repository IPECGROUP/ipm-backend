// app/api/admin/unit-access/[[...id]]/route.js
export const runtime = "nodejs";

import { prisma } from "../../../../../lib/prisma";

function pickIdFromParams(params) {
  const raw = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pickIdFromUrl(request) {
  try {
    const { pathname } = new URL(request.url);
    // مثال: /api/admin/unit-access/1
    const parts = pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (!last || last === "unit-access") return null;
    const n = Number(last);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
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

    const items = await prisma.unitAccessRule.findMany({
      where: { unitId },
      orderBy: { id: "asc" },
    });

    return Response.json({ items });
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
    const tab = body.tab === null || body.tab === undefined ? null : String(body.tab).trim();
    const permitted = body.permitted === 0 ? 0 : 1;

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

    const item = await prisma.unitAccessRule.create({
      data: { unitId, page, tab, permitted },
    });

    return Response.json({ ok: true, item });
  } catch (e) {
    console.error("unit_access_post_error", e);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// DELETE /api/admin/unit-access/:id
export async function DELETE(request, { params }) {
  try {
    const id = pickIdFromParams(params) ?? pickIdFromUrl(request);
    if (!id) {
      return new Response(JSON.stringify({ error: "invalid_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const item = await prisma.unitAccessRule.delete({ where: { id } });
    return Response.json({ ok: true, item });
  } catch (e) {
    console.error("unit_access_delete_error", e);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
