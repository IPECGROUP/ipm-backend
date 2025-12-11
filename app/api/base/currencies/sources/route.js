// app/api/base/currencies/sources/route.js
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const items = await prisma.currencySource.findMany({
      orderBy: { title: "asc" },
    });
    return NextResponse.json({ items });
  } catch (e) {
    console.error("currency_sources_get_error", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const title = String(body.title || "").trim();

    if (!title) {
      return NextResponse.json({ error: "title_required" }, { status: 400 });
    }

    const row = await prisma.currencySource.create({
      data: { title },
    });

    return NextResponse.json({ item: row, id: row.id });
  } catch (e) {
    console.error("currency_sources_post_error", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const id = Number(body.id);
    const title = String(body.title || "").trim();

    if (!id || !Number.isFinite(id)) {
      return NextResponse.json({ error: "invalid_id" }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ error: "title_required" }, { status: 400 });
    }

    const row = await prisma.currencySource.update({
      where: { id },
      data: { title },
    });

    return NextResponse.json({ ok: true, item: row });
  } catch (e) {
    console.error("currency_sources_patch_error", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json();
    const id = Number(body.id);

    if (!id || !Number.isFinite(id)) {
      return NextResponse.json({ error: "invalid_id" }, { status: 400 });
    }

    const row = await prisma.currencySource.delete({
      where: { id },
    });

    return NextResponse.json({ ok: true, item: row });
  } catch (e) {
    console.error("currency_sources_delete_error", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

