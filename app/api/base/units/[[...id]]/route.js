// app/api/base/units/[[...id]]/route.js
export const runtime = "nodejs";

import { prisma } from "../../../../../lib/prisma";
import { Prisma } from "@prisma/client";
import { isDbConnectionError, readOrgStore, writeOrgStore } from "../../../../../lib/orgStructureFallback";

function getId(request, params) {
  let raw = params?.id;

  if (Array.isArray(raw)) raw = raw[0];

  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (n && Number.isFinite(n)) return n;
  }

  try {
    const { pathname } = new URL(request.url);
    const m = pathname.match(/\/base\/units\/(\d+)(?:\/)?$/) || pathname.match(/\/units\/(\d+)(?:\/)?$/);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (n && Number.isFinite(n)) return n;
    }
  } catch {}

  return 0;
}

export async function GET(request, { params }) {
  const id = getId(request, params);
  try {
   if (id) {
  const item = await prisma.unit.findUnique({ where: { id } });

  return Response.json({
    ok: true,
    item: item ? { ...item, label: item.name } : null,
  });
}

   const units = await prisma.unit.findMany({
  orderBy: { name: "asc" },
});

return Response.json({
  ok: true,
  units: (units || []).map((u) => ({
    ...u,
    label: u.name, // ✅ برای فرانت LettersPage
  })),
});

  } catch (e) {
    console.error("units_get_error", e);
    if (isDbConnectionError(e)) {
      const data = readOrgStore();
      if (id) {
        const item = data.units.find((u) => Number(u.id) === id) || null;
        return Response.json({ ok: true, fallback: true, item: item ? { ...item, label: item.name } : null });
      }
      return Response.json({
        ok: true,
        fallback: true,
        units: data.units.map((u) => ({ ...u, label: u.name })),
      });
    }
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function POST(request, { params }) {
  const id = getId(request, params);
  const body = await request.json().catch(() => ({}));
  try {
    if (id) {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

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
    if (isDbConnectionError(e)) {
      const name = String(body.name || "").trim();
      const code = body.code ? String(body.code).trim() : null;
      if (!name) {
        return new Response(JSON.stringify({ error: "name_required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const data = readOrgStore();
      let item = data.units.find((u) => String(u.name || "").trim() === name) || null;
      if (!item) {
        item = { id: data.nextUnitId++, name, code };
        data.units.push(item);
        writeOrgStore(data);
      }
      return Response.json({ ok: true, fallback: true, item: { ...item, label: item.name } });
    }
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function PATCH(request, { params }) {
  const id = getId(request, params);
  const body = await request.json().catch(() => ({}));
  try {
    if (!id) {
      return new Response(JSON.stringify({ error: "invalid_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

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
    if (isDbConnectionError(e)) {
      if (!id) {
        return new Response(JSON.stringify({ error: "invalid_id" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const data = readOrgStore();
      const item = data.units.find((u) => Number(u.id) === id) || null;
      if (!item) {
        return new Response(JSON.stringify({ error: "unit_not_found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (body.name !== undefined) item.name = String(body.name || "").trim();
      if (body.code !== undefined) item.code = body.code === null ? null : String(body.code || "").trim();
      writeOrgStore(data);
      return Response.json({ ok: true, fallback: true, item: { ...item, label: item.name } });
    }
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function DELETE(request, { params }) {
  const id = getId(request, params);
  try {
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
    if (isDbConnectionError(e)) {
      if (!id) {
        return new Response(JSON.stringify({ error: "invalid_id" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const data = readOrgStore();
      const item = data.units.find((u) => Number(u.id) === id) || null;
      data.units = data.units.filter((u) => Number(u.id) !== id);
      data.unitRoles = data.unitRoles.filter((x) => Number(x.unitId) !== id);
      data.userUnits = data.userUnits.filter((x) => Number(x.unitId) !== id);
      writeOrgStore(data);
      return Response.json({ ok: true, fallback: true, item });
    }

    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2003") {
        return new Response(JSON.stringify({ error: "unit_in_use" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (e.code === "P2025") {
        return new Response(JSON.stringify({ error: "unit_not_found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
