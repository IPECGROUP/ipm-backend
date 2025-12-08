// app/api/base/units/route.js
export const runtime = "nodejs";

import { prisma } from "../../../../lib/prisma";

// GET /api/base/units → لیست واحدها
export async function GET() {
  try {
    const units = await prisma.unit.findMany({
      orderBy: { name: "asc" },
    });

    // UnitsPage از r.units استفاده می‌کند
    return Response.json({ units });
  } catch (e) {
    console.error("units_get_error", e);
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// POST /api/base/units → افزودن واحد جدید
export async function POST(request) {
  try {
    const body = await request.json();
    const name = String(body.name || "").trim();
    const code = body.code ? String(body.code).trim() : null;

    if (!name) {
      return new Response(
        JSON.stringify({ error: "name_required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const unit = await prisma.unit.create({
      data: { name, code },
    });

    return Response.json({ ok: true, item: unit });
  } catch (e) {
    console.error("units_post_error", e);
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
