import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
export const runtime = "nodejs";
export async function POST(request) { try { const body = await request.json().catch(() => ({})); const id = String(body.id || "").trim(); if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 }); const rows = await prisma.$queryRaw`UPDATE project_lessons SET view_count=view_count+1 WHERE id=${id} RETURNING view_count`; if (!rows.length) return NextResponse.json({ error: "not_found" }, { status: 404 }); return NextResponse.json({ viewCount: Number(rows[0].view_count) }); } catch { return NextResponse.json({ error: "view_update_failed" }, { status: 500 }); } }
