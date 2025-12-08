// app/api/base/currencies/types/route.js
export const runtime = "nodejs";

import { prisma } from "../../../../../lib/prisma";

// GET /api/base/currencies/types
export async function GET() {
  try {
    const items = await prisma.currencyType.findMany({
      orderBy: { title: "asc" },
    });
    return Response.json({ items });
  } catch (e) {
    console.error("currency_types_get_error", e);
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// POST /api/base/currencies/types
export async function POST(request) {
  try {
    const body = await request.json();
    const title = String(body.title || "").trim();
    if (!title) {
      return new Response(
        JSON.stringify({ error: "title_required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const row = await prisma.currencyType.create({
      data: { title },
    });

    return Response.json({ item: row, id: row.id });
  } catch (e) {
    console.error("currency_types_post_error", e);
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// PATCH /api/base/currencies/types  (ویرایش با id در body)
export async function PATCH(request) {
  try {
    const body = await request.json();
    const id = Number(body.id);
    const title = String(body.title || "").trim();

    if (!id || !Number.isFinite(id)) {
      return new Response(
        JSON.stringify({ error: "invalid_id" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    if (!title) {
      return new Response(
        JSON.stringify({ error: "title_required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const row = await prisma.currencyType.update({
      where: { id },
      data: { title },
    });

    return Response.json({ ok: true, item: row });
  } catch (e) {
    console.error("currency_types_patch_error", e);
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// DELETE /api/base/currencies/types  (حذف با id در body)
export async function DELETE(request) {
  try {
    const body = await request.json();
    const id = Number(body.id);

    if (!id || !Number.isFinite(id)) {
      return new Response(
        JSON.stringify({ error: "invalid_id" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const row = await prisma.currencyType.delete({
      where: { id },
    });

    return Response.json({ ok: true, item: row });
  } catch (e) {
    console.error("currency_types_delete_error", e);
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
