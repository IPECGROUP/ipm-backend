// app/api/admin/unit-access/[[...id]]/route.js
export const runtime = "nodejs";

import { prisma } from "../../../../../lib/prisma";

function getId(params) {
  const raw = params?.id?.[0];
  const id = raw ? Number(raw) : 0;
  return id && Number.isFinite(id) ? id : 0;
}

// GET /api/admin/unit-access?unit_id=1
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const unitId = Number(searchParams.get("unit_id") || 0);
    if (!unitId) return Response.json({ items: [] });

    const items = await prisma.unitAccessRule.findMany({
      where: { unitId },
      orderBy: [{ page: "asc" }, { tab: "asc" }],
    });

    return Response.json({
      items: items.map((x) => ({
        id: x.id,
        unit_id: x.unitId,
        page: x.page,
        tab: x.tab,
        permitted: x.permitted ? 1 : 0,
      })),
    });
  } catch (e) {
    console.error("unit_access_get_error", e);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// POST /api/admin/unit-access  (upsert)
export async function POST(request) {
  try {
    const body = await request.json();
    const unitId = Number(body.unit_id || 0);
    const page = String(body.page || "").trim();
    const tab = body.tab == null ? null : String(body.tab || "").trim();
    const permitted = body.permitted === 1 || body.permitted === true;

    if (!unitId || !page) {
      return new Response(JSON.stringify({ error: "bad_request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const item = await prisma.unitAccessRule.upsert({
      where: { unitId_page_tab: { unitId, page, tab } },
      update: { permitted },
      create: { unitId, page, tab, permitted },
    });

    return Response.json({
      ok: true,
      item: {
        id: item.id,
        unit_id: item.unitId,
        page: item.page,
        tab: item.tab,
        permitted: item.permitted ? 1 : 0,
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
export async function DELETE(_request, { params }) {
  try {
    const id = getId(params);
    if (!id) {
      return new Response(JSON.stringify({ error: "invalid_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await prisma.unitAccessRule.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (e) {
    console.error("unit_access_delete_error", e);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
