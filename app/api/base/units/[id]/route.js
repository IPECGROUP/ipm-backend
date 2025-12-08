// app/api/base/units/[id]/route.js
export const runtime = "nodejs";

import { prisma } from "../../../../../lib/prisma";

// PATCH /api/base/units/:id → ویرایش واحد
export async function PATCH(request, { params }) {
  try {
    const id = Number(params.id);
    if (!id) {
      return new Response(
        JSON.stringify({ error: "invalid_id" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const body = await request.json();
    const name = body.name ? String(body.name).trim() : undefined;
    const code =
      body.code === undefined
        ? undefined
        : body.code === null
        ? null
        : String(body.code).trim();

    const unit = await prisma.unit.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(code !== undefined ? { code } : {}),
      },
    });

    return Response.json({ ok: true, item: unit });
  } catch (e) {
    console.error("units_patch_error", e);
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// DELETE /api/base/units/:id → حذف واحد
export async function DELETE(request, { params }) {
  try {
    const id = Number(params.id);
    if (!id) {
      return new Response(
        JSON.stringify({ error: "invalid_id" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const unit = await prisma.unit.delete({
      where: { id },
    });

    return Response.json({ ok: true, item: unit });
  } catch (e) {
    console.error("units_delete_error", e);
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
