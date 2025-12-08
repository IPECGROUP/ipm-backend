// app/api/tags/route.js
export const runtime = "nodejs";

import { prisma } from "../../../../lib/prisma";

// GET /api/tags → لیست برچسب‌ها
export async function GET() {
  try {
    const items = await prisma.tag.findMany({
      orderBy: { label: "asc" },
    });

    return Response.json({ items });
  } catch (e) {
    console.error("tags_get_error", e);
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// POST /api/tags → افزودن برچسب جدید
export async function POST(request) {
  try {
    const body = await request.json();
    const label = String(body.label || "").trim();

    if (!label) {
      return new Response(
        JSON.stringify({ error: "label_required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const row = await prisma.tag.create({
      data: { label },
    });

    return Response.json({ item: row, id: row.id });
  } catch (e) {
    console.error("tags_post_error", e);
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// PATCH /api/tags → ویرایش برچسب با id داخل body
export async function PATCH(request) {
  try {
    const body = await request.json();
    const id = Number(body.id);
    const label = String(body.label || "").trim();

    if (!id || !Number.isFinite(id)) {
      return new Response(
        JSON.stringify({ error: "invalid_id" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (!label) {
      return new Response(
        JSON.stringify({ error: "label_required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const row = await prisma.tag.update({
      where: { id },
      data: { label },
    });

    return Response.json({ ok: true, item: row });
  } catch (e) {
    console.error("tags_patch_error", e);
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// DELETE /api/tags → حذف برچسب با id داخل body
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

    const row = await prisma.tag.delete({
      where: { id },
    });

    return Response.json({ ok: true, item: row });
  } catch (e) {
    console.error("tags_delete_error", e);
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
