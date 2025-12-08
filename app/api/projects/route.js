// app/api/projects/route.js
export const runtime = "nodejs";

import { prisma } from "../../../lib/prisma";

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

// GET /api/projects   -> لیست پروژه‌ها
export async function GET() {
  try {
    const items = await prisma.project.findMany({
      orderBy: { code: "asc" },
    });
    return Response.json({ items });
  } catch (e) {
    console.error("projects_get_error", e);
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// POST /api/projects   -> افزودن پروژه
export async function POST(request) {
  try {
    const body = await readJson(request);
    const code = String(body.code || "").trim();
    const name = String(body.name || "").trim();

    if (!code || !name) {
      return new Response(
        JSON.stringify({ error: "code_and_name_required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // (اختیاری) چک تکراری بودن کد
    const exists = await prisma.project.findFirst({
      where: { code },
    });
    if (exists) {
      return new Response(
        JSON.stringify({ error: "duplicate_code" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const item = await prisma.project.create({
      data: { code, name },
    });

    return Response.json({ item });
  } catch (e) {
    console.error("projects_post_error", e);
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// PATCH /api/projects   -> ویرایش (id داخل body)
export async function PATCH(request) {
  try {
    const body = await readJson(request);
    const id = Number(body.id);
    if (!id || Number.isNaN(id)) {
      return new Response(
        JSON.stringify({ error: "invalid_id" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const code =
      body.code !== undefined ? String(body.code || "").trim() : undefined;
    const name =
      body.name !== undefined ? String(body.name || "").trim() : undefined;

    if ((code !== undefined && !code) || (name !== undefined && !name)) {
      return new Response(
        JSON.stringify({ error: "code_and_name_required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const data = {};
    if (code !== undefined) data.code = code;
    if (name !== undefined) data.name = name;

    const item = await prisma.project.update({
      where: { id },
      data,
    });

    return Response.json({ item });
  } catch (e) {
    console.error("projects_patch_error", e);

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

// DELETE /api/projects   -> حذف (id در body یا query ?id=)
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

    const item = await prisma.project.delete({
      where: { id },
    });

    return Response.json({ ok: true, item });
  } catch (e) {
    console.error("projects_delete_error", e);

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
