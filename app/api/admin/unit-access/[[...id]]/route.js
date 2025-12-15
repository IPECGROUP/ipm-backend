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

function toBoolPermitted(v) {
  return v === true || v === 1 || v === "1" || v === "true";
}

function toIntPermitted(v) {
  return v ? 1 : 0;
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

    // ✅ فرانت توی UnitsPage چک می‌کنه permitted !== 1
    // پس اینجا Boolean رو به 1/0 تبدیل می‌کنیم تا UI دست نخورَد
    const items = (rows || []).map((r) => ({
      id: r.id,
      unitId: r.unitId,
      page: r.page,
      tab: r.tab,
      permitted: toIntPermitted(r.permitted),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

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
    const tab =
      body.tab === null || body.tab === undefined ? null : String(body.tab).trim();
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

    const item = await prisma.unitAccessRule.create({
      data: { unitId, page, tab, permitted }, // ✅ permitted بولی
    });

    // خروجی هم برای UI با 1/0 برگرده (هماهنگ با GET)
    return Response.json({
      ok: true,
      item: {
        id: item.id,
        unitId: item.unitId,
        page: item.page,
        tab: item.tab,
        permitted: toIntPermitted(item.permitted),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      },
    });
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

    return Response.json({
      ok: true,
      item: {
        id: item.id,
        unitId: item.unitId,
        page: item.page,
        tab: item.tab,
        permitted: toIntPermitted(item.permitted),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      },
    });
  } catch (e) {
    console.error("unit_access_delete_error", e);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
