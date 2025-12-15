// کاربران
// app/api/admin/users/route.js
export const runtime = "nodejs";

import { prisma } from "../../../../lib/prisma";
import bcrypt from "bcryptjs";

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function pickDelegate(names) {
  for (const n of names) {
    const d = prisma?.[n];
    if (d && typeof d.findMany === "function") return d;
  }
  return null;
}

function ensureIntArray(v) {
  const arr = Array.isArray(v) ? v : v == null ? [] : [v];
  return Array.from(
    new Set(
      arr
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  );
}

const userUnitsDelegate = () =>
  pickDelegate([
    "userUnit",
    "userUnits",
    "userUnitMap",
    "userUnitsMap",
    "userToUnit",
    "usersOnUnits",
  ]);

async function getUnitIdsForUser(userId) {
  const d = userUnitsDelegate();
  if (!d) return [];
  const rows = await d.findMany({
    where: { userId },
    select: { unitId: true },
  });
  return Array.from(new Set((rows || []).map((r) => r.unitId).filter(Boolean)));
}

async function setUnitIdsForUser(userId, unitIds) {
  const d = userUnitsDelegate();
  if (!d) return;

  await d.deleteMany({ where: { userId } });

  for (const unitId of unitIds) {
    await d.create({ data: { userId, unitId } });
  }
}

// نرمال‌سازی خروجی کاربر برای فرانت
async function mapUser(u) {
  if (!u) return null;
  const roles = Array.isArray(u.roles) ? u.roles : [];
  const unitIds = await getUnitIdsForUser(u.id);

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    username: u.username,
    department: u.department,
    role: u.role,
    access: u.access || [],
    access_labels: u.access || [],
    unitIds,
    positions: roles.map((link) => ({
      id: link.role.id,
      name: link.role.name,
    })),
  };
}

async function hashPasswordIfProvided(pw) {
  const p = String(pw || "");
  if (!p) return null;
  return await bcrypt.hash(p, 10);
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
          JSON.stringify({ error: "invalid_id", message: "شناسه نامعتبر است" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const user = await prisma.user.findUnique({
        where: { id },
        include: { roles: { include: { role: true } } },
      });

      if (!user) {
        return new Response(
          JSON.stringify({ error: "not_found", message: "کاربر پیدا نشد" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      return Response.json({ user: await mapUser(user) });
    }

    const users = await prisma.user.findMany({
      orderBy: { id: "asc" },
      include: { roles: { include: { role: true } } },
    });

    const mapped = [];
    for (const u of users) mapped.push(await mapUser(u));

    return Response.json({ users: mapped });
  } catch (e) {
    console.error("admin_users_get_error", e);
    return new Response(
      JSON.stringify({
        error: "internal_error",
        message: e?.message || "unknown_error",
        code: e?.code || null,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
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
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const name = body.name ? String(body.name).trim() : null;
    const email = body.email ? String(body.email).trim() : null;
    const department = body.department ? String(body.department).trim() : null;
    const role = body.role ? String(body.role).trim() : "user";

    const access = Array.isArray(body.access)
      ? body.access.map((v) => String(v || ""))
      : [];

    // roles
    const rawRoleIds =
      Array.isArray(body.positions) && body.positions.length
        ? body.positions
        : Array.isArray(body.roles) && body.roles.length
        ? body.roles
        : [];
    const roleIds = rawRoleIds
      .map((v) => Number(v))
      .filter((v) => !Number.isNaN(v) && v > 0);

    // units
    const unitIds = ensureIntArray(body.unitIds ?? body.unit_ids ?? body.units ?? []);

    const passwordHash = await hashPasswordIfProvided(password);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        username,
        password: passwordHash,
        department,
        role,
        access,
        roles: {
          create: roleIds.map((roleId) => ({
            role: { connect: { id: roleId } },
          })),
        },
      },
      include: { roles: { include: { role: true } } },
    });

    // ذخیره عضویت در واحدها (اگر مدلش موجود باشد)
    try {
      if (unitIds.length) await setUnitIdsForUser(user.id, unitIds);
      else await setUnitIdsForUser(user.id, []); // پاکسازی
    } catch (e) {
      console.error("admin_users_set_units_error", e);
    }

    return Response.json({ user: await mapUser(user) });
  } catch (e) {
    console.error("admin_users_post_error", e);
    return new Response(
      JSON.stringify({
        error: "internal_error",
        message: e?.message || "unknown_error",
        code: e?.code || null,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
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
        JSON.stringify({ error: "invalid_id", message: "شناسه نامعتبر است" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = {};

    if (body.name !== undefined)
      data.name =
        body.name === null ? null : String(body.name || "").trim() || null;

    if (body.email !== undefined)
      data.email =
        body.email === null ? null : String(body.email || "").trim() || null;

    if (body.username !== undefined) data.username = String(body.username || "").trim();

    if (body.department !== undefined)
      data.department =
        body.department === null ? null : String(body.department || "").trim() || null;

    if (body.role !== undefined) data.role = String(body.role || "user").trim();

    if (body.password) {
      data.password = await hashPasswordIfProvided(body.password);
    }

    if (Array.isArray(body.access)) {
      data.access = body.access.map((v) => String(v || ""));
    }

    // roles
    const rawRoleIds =
      Array.isArray(body.positions) && body.positions.length
        ? body.positions
        : Array.isArray(body.roles) && body.roles.length
        ? body.roles
        : null;

    let rolesUpdate = undefined;
    if (rawRoleIds !== null) {
      const roleIds = rawRoleIds
        .map((v) => Number(v))
        .filter((v) => !Number.isNaN(v) && v > 0);

      rolesUpdate = {
        deleteMany: {},
        create: roleIds.map((roleId) => ({
          role: { connect: { id: roleId } },
        })),
      };
    }

    const user = await prisma.user.update({
      where: { id },
      data: { ...data, ...(rolesUpdate ? { roles: rolesUpdate } : {}) },
      include: { roles: { include: { role: true } } },
    });

    // units (اگر فرستاده شد)
    if (
      body.unitIds !== undefined ||
      body.unit_ids !== undefined ||
      body.units !== undefined
    ) {
      const unitIds = ensureIntArray(body.unitIds ?? body.unit_ids ?? body.units ?? []);
      try {
        await setUnitIdsForUser(id, unitIds);
      } catch (e) {
        console.error("admin_users_set_units_error", e);
      }
    }

    return Response.json({ user: await mapUser(user) });
  } catch (e) {
    console.error("admin_users_patch_error", e);
    return new Response(
      JSON.stringify({
        error: "internal_error",
        message: e?.message || "unknown_error",
        code: e?.code || null,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
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
        JSON.stringify({ error: "invalid_id", message: "شناسه نامعتبر است" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    await prisma.userRoleMap.deleteMany({ where: { userId: id } });

    // پاک کردن عضویت واحدها (اگر مدلش موجود باشد)
    try {
      const d = userUnitsDelegate();
      if (d) await d.deleteMany({ where: { userId: id } });
    } catch (e) {
      console.error("admin_users_delete_units_error", e);
    }

    const deleted = await prisma.user.delete({
      where: { id },
      include: { roles: { include: { role: true } } },
    });

    return Response.json({ ok: true, user: await mapUser({ ...deleted, roles: [] }) });
  } catch (e) {
    console.error("admin_users_delete_error", e);
    return new Response(
      JSON.stringify({
        error: "internal_error",
        message: e?.message || "unknown_error",
        code: e?.code || null,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
