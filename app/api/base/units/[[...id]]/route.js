// app/api/base/units/[[...id]]/route.js
export const runtime = "nodejs";

import { prisma } from "../../../../../lib/prisma";
import { Prisma } from "@prisma/client";

// helper: گرفتن id از مسیر /api/base/units/:id
function getId(params) {
  const raw = params?.id?.[0];
  const id = raw ? Number(raw) : 0;
  return id && Number.isFinite(id) ? id : 0;
}

// GET /api/base/units  → لیست
// GET /api/base/units/:id → یک واحد
export async function GET(request, { params }) {
  try {
    const id = getId(params);

    if (id) {
      const item = await prisma.unit.findUnique({ where: { id } });
      return Response.json({ ok: true, item });
    }

    const units = await prisma.unit.findMany({
      orderBy: { name: "asc" },
    });

    return Response.json({ units });
  } catch (e) {
    console.error("units_get_error", e);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// POST /api/base/units → افزودن واحد
export async function POST(request, { params }) {
  try {
    const id = getId(params);
    if (id) {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await request.json();
    const name = String(body.name || "").trim();
    const code = body.code ? String(body.code).trim() : null;

    if (!name) {
      return new Response(JSON.stringify({ error: "name_required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const unit = await prisma.unit.create({ data: { name, code } });
    return Response.json({ ok: true, item: unit });
  } catch (e) {
    console.error("units_post_error", e);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// PATCH /api/base/units/:id → ویرایش
export async function PATCH(request, { params }) {
  try {
    const id = getId(params);
    if (!id) {
      return new Response(JSON.stringify({ error: "invalid_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
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
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// DELETE /api/base/units/:id → حذف
export async function DELETE(_request, { params }) {
  try {
    const id = getId(params);
    if (!id) {
      return new Response(JSON.stringify({ error: "invalid_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const unit = await prisma.unit.delete({ where: { id } });
    return Response.json({ ok: true, item: unit });
  } catch (e) {
    console.error("units_delete_error", e);

    // ✅ در Next.js به جای instanceof مطمئن‌ترین روش چک کردن code هست
    const code = e?.code;

    // FK constraint (unit is referenced somewhere)
    if (code === "P2003") {
      return new Response(
        JSON.stringify({
          error: "unit_in_use",
          meta: e?.meta || null,
        }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Record not found
    if (code === "P2025") {
      return new Response(JSON.stringify({ error: "unit_not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
