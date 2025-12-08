// app/api/admin/users/route.js
export const runtime = "nodejs";

import { prisma } from "../../../../lib/prisma";

// خوندن JSON امن
async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// نرمال‌سازی خروجی کاربر برای فرانت
function mapUser(u) {
  if (!u) return null;
  const roles = Array.isArray(u.roles) ? u.roles : [];
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    username: u.username,
    department: u.department,
    role: u.role,
    access: u.access || [],
    access_labels: u.access || [],
    positions: roles.map((link) => ({
      id: link.role.id,
      name: link.role.name,
    })),
  };
}

// GET /api/admin/users
//  - بدون id → لیست همه‌ی کاربران
//  - با ?id= → یک کاربر تکی
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get("id");

    if (idParam) {
      const id = Number(idParam);
      if (!id || Number.isNaN(id)) {
        return new Response(
          JSON.stringify({
            error: "invalid_id",
            message: "شناسه نامعتبر است",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const user = await prisma.user.findUnique({
        where: { id },
        include: {
          roles: { include: { role: true } },
        },
      });

      if (!user) {
        return new Response(
          JSON.stringify({
            error: "not_found",
            message: "کاربر پیدا نشد",
          }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return Response.json({ user: mapUser(user) });
    }

    // لیست همه کاربران
    const users = await prisma.user.findMany({
      orderBy: { id: "asc" },
      include: {
        roles: { include: { role: true } },
      },
    });

    return Response.json({
      users: users.map(mapUser),
    });
  } catch (e) {
    console.error("admin_users_get_error", e);
    return new Response(
      JSON.stringify({
        error: "internal_error",
        message: e?.message || "unknown_error",
        code: e?.code || null,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// POST /api/admin/users  → ساخت کاربر جدید
export async function POST(request) {
  try {
    const body = await readJson(request);

    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!username || !password) {
      return new Response(
        JSON.stringify({
          error: "username_password_required",
          message: "نام کاربری و گذرواژه الزامی است",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const name = body.name ? String(body.name).trim() : null;
    const email = body.email ? String(body.email).trim() : null;
    const department = body.department
      ? String(body.department).trim()
      : null;
    const role = body.role ? String(body.role).trim() : "user";

    const access = Array.isArray(body.access)
      ? body.access.map((v) => String(v || ""))
      : [];

    // positions / roles → آرایه id نقش‌ها
    const rawRoleIds =
      Array.isArray(body.positions) && body.positions.length
        ? body.positions
        : Array.isArray(body.roles)
        ? body.roles
        : [];
    const roleIds = rawRoleIds
      .map((v) => Number(v))
      .filter((v) => !Number.isNaN(v) && v > 0);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        username,
        password, // بعداً می‌تونی هش کنی
        department,
        role,
        access,
        roles: {
          create: roleIds.map((roleId) => ({
            role: { connect: { id: roleId } },
          })),
        },
      },
      include: {
        roles: { include: { role: true } },
      },
    });

    return Response.json({ user: mapUser(user) });
  } catch (e) {
    console.error("admin_users_post_error", e);
    return new Response(
      JSON.stringify({
        error: "internal_error",
        message: e?.message || "unknown_error",
        code: e?.code || null,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// PATCH /api/admin/users  → ویرایش کاربر (id داخل body)
export async function PATCH(request) {
  try {
    const body = await readJson(request);

    const id = Number(body.id);
    if (!id || Number.isNaN(id)) {
      return new Response(
        JSON.stringify({
          error: "invalid_id",
          message: "شناسه نامعتبر است",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const data = {};

    if (body.name !== undefined)
      data.name =
        body.name === null
          ? null
          : String(body.name || "").trim() || null;

    if (body.email !== undefined)
      data.email =
        body.email === null
          ? null
          : String(body.email || "").trim() || null;

    if (body.username !== undefined)
      data.username = String(body.username || "").trim();

    if (body.department !== undefined)
      data.department =
        body.department === null
          ? null
          : String(body.department || "").trim() || null;

    if (body.role !== undefined)
      data.role = String(body.role || "user").trim();

    if (body.password) {
      data.password = String(body.password);
    }

    if (Array.isArray(body.access)) {
      data.access = body.access.map((v) => String(v || ""));
    }

    // positions / roles → آرایه id نقش‌ها
    const rawRoleIds =
      Array.isArray(body.positions) && body.positions.length
        ? body.positions
        : Array.isArray(body.roles)
        ? body.roles
        : null;

    let rolesUpdate = undefined;
    if (rawRoleIds !== null) {
      const roleIds = rawRoleIds
        .map((v) => Number(v))
        .filter((v) => !Number.isNaN(v) && v > 0);

      rolesUpdate = {
        deleteMany: {}, // همه مپ‌های قبلی
        create: roleIds.map((roleId) => ({
          role: { connect: { id: roleId } },
        })),
      };
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...data,
        ...(rolesUpdate ? { roles: rolesUpdate } : {}),
      },
      include: {
        roles: { include: { role: true } },
      },
    });

    return Response.json({ user: mapUser(user) });
  } catch (e) {
    console.error("admin_users_patch_error", e);
    return new Response(
      JSON.stringify({
        error: "internal_error",
        message: e?.message || "unknown_error",
        code: e?.code || null,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// DELETE /api/admin/users  → حذف کاربر (id داخل body)
export async function DELETE(request) {
  try {
    const body = await readJson(request);
    const id = Number(body.id);
    if (!id || Number.isNaN(id)) {
      return new Response(
        JSON.stringify({
          error: "invalid_id",
          message: "شناسه نامعتبر است",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // اول مپ نقش‌ها رو پاک کن
    await prisma.userRoleMap.deleteMany({
      where: { userId: id },
    });

    const deleted = await prisma.user.delete({
      where: { id },
      include: {
        roles: { include: { role: true } },
      },
    });

    return Response.json({
      ok: true,
      user: mapUser({ ...deleted, roles: [] }),
    });
  } catch (e) {
    console.error("admin_users_delete_error", e);
    return new Response(
      JSON.stringify({
        error: "internal_error",
        message: e?.message || "unknown_error",
        code: e?.code || null,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
