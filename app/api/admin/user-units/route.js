// app/api/admin/user-units/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "../../../../lib/prisma";
import { isDbConnectionError, readOrgStore, writeOrgStore } from "../../../../lib/orgStructureFallback";

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function readJsonSafe(request) {
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    return await request.json();
  }
  const txt = await request.text();
  if (!txt) return {};
  try {
    return JSON.parse(txt);
  } catch {
    return {};
  }
}

// GET /api/admin/user-units?user_id=9
// GET /api/admin/user-units?unit_id=1
export async function GET(request) {
  const url = new URL(request.url);
  const userId = toInt(url.searchParams.get("user_id") ?? url.searchParams.get("userId"));
  const unitId = toInt(url.searchParams.get("unit_id") ?? url.searchParams.get("unitId"));
  try {
    if (!userId && !unitId) {
      return new Response(JSON.stringify({ error: "user_id_or_unit_id_required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (userId) {
      const rows = await prisma.userUnit.findMany({
        where: { userId },
        include: { unit: true },
        orderBy: { unitId: "asc" },
      });

      return Response.json({
        ok: true,
        items: rows.map((r) => ({
          userId: r.userId,
          unitId: r.unitId,
          unit: r.unit ? { id: r.unit.id, name: r.unit.name, code: r.unit.code } : null,
        })),
      });
    }

    const rows = await prisma.userUnit.findMany({
      where: { unitId },
      include: { user: true },
      orderBy: { userId: "asc" },
    });

    return Response.json({
      ok: true,
      items: rows.map((r) => ({
        userId: r.userId,
        unitId: r.unitId,
        user: r.user
          ? { id: r.user.id, username: r.user.username, name: r.user.name, email: r.user.email, role: r.user.role }
          : null,
      })),
    });
  } catch (e) {
    console.error("user_units_get_error", e);
    if (isDbConnectionError(e)) {
      const data = readOrgStore();
      if (userId) {
        return Response.json({
          ok: true,
          fallback: true,
          items: data.userUnits
            .filter((row) => Number(row.userId) === userId)
            .map((row) => ({ userId: row.userId, unitId: row.unitId, unit: data.units.find((u) => Number(u.id) === Number(row.unitId)) || null })),
        });
      }
      return Response.json({
        ok: true,
        fallback: true,
        items: data.userUnits
          .filter((row) => Number(row.unitId) === unitId)
          .map((row) => ({ userId: row.userId, unitId: row.unitId, user: data.users.find((u) => Number(u.id) === Number(row.userId)) || null })),
      });
    }
    return new Response(JSON.stringify({ error: "internal_error", message: e?.message || "" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// POST /api/admin/user-units
// حالت‌ها:
// 1) { user_id: 9, unit_id: 1 } => افزودن یک عضویت
// 2) { user_id: 9, unit_ids: [1,2] } => جایگزینی کامل عضویت‌های کاربر
export async function POST(request) {
  const body = await readJsonSafe(request);
  try {
    const userId = toInt(body.user_id ?? body.userId);
    const singleUnitId = toInt(body.unit_id ?? body.unitId);

    const unitIdsRaw = Array.isArray(body.unit_ids ?? body.unitIds) ? (body.unit_ids ?? body.unitIds) : null;
    const unitIds = unitIdsRaw ? unitIdsRaw.map(toInt).filter(Boolean) : null;

    if (!userId) {
      return new Response(JSON.stringify({ error: "user_id_required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // replace
    if (unitIds) {
      await prisma.userUnit.deleteMany({ where: { userId } });

      if (unitIds.length > 0) {
        await prisma.userUnit.createMany({
          data: unitIds.map((unitId) => ({ userId, unitId })),
          skipDuplicates: true,
        });
      }

      const rows = await prisma.userUnit.findMany({ where: { userId }, orderBy: { unitId: "asc" } });
      return Response.json({ ok: true, userId, unitIds: rows.map((r) => r.unitId) });
    }

    // add single
    if (!singleUnitId) {
      return new Response(JSON.stringify({ error: "unit_id_or_unit_ids_required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await prisma.userUnit.create({
      data: { userId, unitId: singleUnitId },
    });

    return Response.json({ ok: true, userId, unitId: singleUnitId });
  } catch (e) {
    // اگر duplicate شد (قبلاً عضو بوده)، مشکلی نیست
    if (String(e?.code || "") === "P2002") {
      return Response.json({ ok: true, note: "already_exists" });
    }
    console.error("user_units_post_error", e);
    if (isDbConnectionError(e)) {
      const data = readOrgStore();
      const userId = toInt(body.user_id ?? body.userId);
      const singleUnitId = toInt(body.unit_id ?? body.unitId);
      const unitIdsRaw = Array.isArray(body.unit_ids ?? body.unitIds) ? (body.unit_ids ?? body.unitIds) : null;
      const unitIds = unitIdsRaw ? unitIdsRaw.map(toInt).filter(Boolean) : null;
      if (!userId) return new Response(JSON.stringify({ error: "user_id_required" }), { status: 400, headers: { "Content-Type": "application/json" } });
      if (unitIds) {
        data.userUnits = data.userUnits.filter((x) => Number(x.userId) !== userId);
        unitIds.forEach((unitId) => data.userUnits.push({ userId, unitId }));
      } else if (singleUnitId && !data.userUnits.some((x) => Number(x.userId) === userId && Number(x.unitId) === singleUnitId)) {
        data.userUnits.push({ userId, unitId: singleUnitId });
      }
      writeOrgStore(data);
      return Response.json({ ok: true, fallback: true, userId, unitIds: unitIds || [singleUnitId].filter(Boolean) });
    }
    return new Response(JSON.stringify({ error: "internal_error", message: e?.message || "" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// DELETE /api/admin/user-units?user_id=9&unit_id=1
export async function DELETE(request) {
  const url = new URL(request.url);
  const userId = toInt(url.searchParams.get("user_id") ?? url.searchParams.get("userId"));
  const unitId = toInt(url.searchParams.get("unit_id") ?? url.searchParams.get("unitId"));
  try {
    if (!userId || !unitId) {
      return new Response(JSON.stringify({ error: "user_id_and_unit_id_required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await prisma.userUnit.delete({
      where: { userId_unitId: { userId, unitId } },
    });

    return Response.json({ ok: true });
  } catch (e) {
    // اگر نبود هم مهم نیست
    if (String(e?.code || "") === "P2025") return Response.json({ ok: true });
    console.error("user_units_delete_error", e);
    if (isDbConnectionError(e)) {
      const data = readOrgStore();
      data.userUnits = data.userUnits.filter((x) => !(Number(x.userId) === userId && Number(x.unitId) === unitId));
      writeOrgStore(data);
      return Response.json({ ok: true, fallback: true });
    }
    return new Response(JSON.stringify({ error: "internal_error", message: e?.message || "" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

