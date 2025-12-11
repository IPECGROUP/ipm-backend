// app/api/base/currencies/types/route.js
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// GET /api/base/currencies/types
export async function GET() {
  try {
    const items = await prisma.currencyType.findMany({
      orderBy: { title: "asc" },
    });
    return NextResponse.json({ items });
  } catch (e) {
    console.error("currency_types_get_error", e);
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500 }
    );
  }
}

// POST /api/base/currencies/types
export async function POST(request) {
  try {
    const body = await request.json();
    const title = String(body.title || "").trim();

    if (!title) {
      return NextResponse.json(
        { error: "title_required" },
        { status: 400 }
      );
    }

    const row = await prisma.currencyType.create({
      data: { title },
    });

    // فرانتت انتظار داره id برگرده
    return NextResponse.json({ item: row, id: row.id });
  } catch (e) {
    console.error("currency_types_post_error", e);
    // یونیک بودن title → می‌تونه اینجا هم خطا بده
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500 }
    );
  }
}

// PATCH /api/base/currencies/types
export async function PATCH(request) {
  try {
    const body = await request.json();
    const id = Number(body.id);
    const title = String(body.title || "").trim();

    if (!id || !Number.isFinite(id)) {
      return NextResponse.json(
        { error: "invalid_id" },
        { status: 400 }
      );
    }
    if (!title) {
      return NextResponse.json(
        { error: "title_required" },
        { status: 400 }
      );
    }

    const row = await prisma.currencyType.update({
      where: { id },
      data: { title },
    });

    return NextResponse.json({ ok: true, item: row });
  } catch (e) {
    console.error("currency_types_patch_error", e);
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500 }
    );
  }
}

// DELETE /api/base/currencies/types
export async function DELETE(request) {
  try {
    const body = await request.json();
    const id = Number(body.id);

    if (!id || !Number.isFinite(id)) {
      return NextResponse.json(
        { error: "invalid_id" },
        { status: 400 }
      );
    }

    const row = await prisma.currencyType.delete({
      where: { id },
    });

    return NextResponse.json({ ok: true, item: row });
  } catch (e) {
    console.error("currency_types_delete_error", e);
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500 }
    );
  }
}
