// app/api/base/user-roles/route.js
export const runtime = "nodejs";

import { prisma } from "../../../../lib/prisma";

// کمک‌تابع برای خوندن body امن
async function readJson(request) {
  try {
    const text = await request.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// GET /api/base/user-roles  => لیست نقش‌ها
export async function GET() {
  try {
    const items = await prisma.userRole.findMany({
      orderBy: { id: "asc" },
    });
    return Response.json({ items });
  } catch (e) {
    console.error("user_roles_get_error", e);
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// POST /api/base/user-roles  => افزودن نقش
export async function POST(request) {
  try {
    const body = await readJson(request);
    const name = String(body.name || "").trim();

    if (!name) {
      return new Response(
        JSON.stringify({ error: "name_required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const item = await prisma.userRole.create({
      data: { name },
    });

    return Response.json({ item });
  } catch (e) {
    console.error("user_roles_post_error", e);
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// PATCH /api/base/user-roles  => ویرایش (id و name در body)
export async function PATCH(request) {
  try {
    const body = await readJson(request);
    const id = Number(body.id);
    const name = String(body.name || "").trim();

    if (!id || Number.isNaN(id)) {
      return new Response(
        JSON.stringify({ error: "invalid_id" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (!name) {
      return new Response(
        JSON.stringify({ error: "name_required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const item = await prisma.userRole.update({
      where: { id },
      data: { name },
    });

    return Response.json({ item });
  } catch (e) {
    console.error("user_roles_patch_error", e);

    if (e.code === "P2025") {
      return new Response(
        JSON.stringify({ error: "not_found" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: "internal_error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// DELETE /api/base/user-roles  => حذف (id در body یا query)
export async function DELETE(request) {
  try {
    const url = new URL(request.url);
    const fromQuery = url.searchParams.get("id");
    let id = fromQuery ? Number(fromQuery) : null;

    if (!id || Number.isNaN(id)) {
      const body = await readJson(request);
      id = Number(body.id);
    }

    if (!id || Number.isNaN(id)) {
      return new Response(
        JSON.stringify({ error: "invalid_id" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const item = await prisma.userRole.delete({
      where: { id },
    });

    return Response.json({ ok: true, item });
  } catch (e) {
    console.error("user_roles_delete_error", e);

    if (e.code === "P2025") {
      return new Response(
        JSON.stringify({ error: "not_found" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: "internal_error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
