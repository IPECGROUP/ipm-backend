// app/api/base/user-roles/route.js
export const runtime = "nodejs";

import { prisma } from "../../../../lib/prisma";
import { isDbConnectionError, readOrgStore, writeOrgStore } from "../../../../lib/orgStructureFallback";

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
    if (isDbConnectionError(e)) {
      const data = readOrgStore();
      return Response.json({ ok: true, fallback: true, items: data.roles });
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

// POST /api/base/user-roles  => افزودن نقش
export async function POST(request) {
  const body = await readJson(request);
  try {
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
    if (isDbConnectionError(e)) {
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
      const data = readOrgStore();
      let item = data.roles.find((role) => String(role.name || "").trim() === name) || null;
      if (!item) {
        item = { id: data.nextRoleId++, name };
        data.roles.push(item);
        writeOrgStore(data);
      }
      return Response.json({ ok: true, fallback: true, item });
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

// PATCH /api/base/user-roles  => ویرایش (id و name در body)
export async function PATCH(request) {
  const body = await readJson(request);
  try {
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
    if (isDbConnectionError(e)) {
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
      const data = readOrgStore();
      const item = data.roles.find((role) => Number(role.id) === id) || null;
      if (!item) {
        return new Response(
          JSON.stringify({ error: "not_found" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      item.name = name;
      writeOrgStore(data);
      return Response.json({ ok: true, fallback: true, item });
    }

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
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("id");
  const body = fromQuery ? {} : await readJson(request);
  const requestedId = fromQuery ? Number(fromQuery) : Number(body.id);
  try {
    let id = requestedId;

    if (!id || Number.isNaN(id)) {
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
    if (isDbConnectionError(e)) {
      const id = requestedId;
      if (!id || Number.isNaN(id)) {
        return new Response(
          JSON.stringify({ error: "invalid_id" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      const data = readOrgStore();
      const item = data.roles.find((role) => Number(role.id) === id) || null;
      data.roles = data.roles.filter((role) => Number(role.id) !== id);
      data.unitRoles = data.unitRoles.filter((link) => Number(link.roleId) !== id);
      data.userRoles = data.userRoles.filter((link) => Number(link.roleId) !== id);
      writeOrgStore(data);
      return Response.json({ ok: true, fallback: true, item });
    }

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
