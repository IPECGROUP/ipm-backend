import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const rows = await prisma.revenueEstimateRow.findMany({
    orderBy: { rowIndex: "asc" },
  });

  const items = rows.map((r) => {
    const t = String(r.title ?? "").trim();
    const isOther = r.projectId == null && (t === "سایر" || t.startsWith("سایر › "));
    return {
      id: r.id,
      code: r.code,
      row_index: r.rowIndex,
      title: r.title,
      description: r.description ?? "",
      project_id: r.projectId,
      is_other: isOther,
      months: Array.isArray(r.monthsJson) ? r.monthsJson : (r.monthsJson ?? []),
      amount: r.amount?.toString?.() ?? "0",
    };
  });

  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req) {
  const body = await req.json().catch(() => null);
  const rows = body?.rows;

  if (!Array.isArray(rows)) {
    return NextResponse.json(
      { error: "invalid_payload", message: "rows must be an array" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const normalized = rows.map((r, idx) => ({
    code: String(r.code ?? `R${idx + 1}`),
    rowIndex: Number(r.row_index ?? idx + 1),
    title: String(r.title ?? "").trim(),
    description: String(r.description ?? ""),
    projectId: r.project_id == null ? null : Number(r.project_id),
    monthsJson: Array.isArray(r.months) ? r.months : [],
    amount: BigInt(String(r.amount ?? "0").replace(/[^\d]/g, "") || "0"),
  }));

  await prisma.$transaction(async (tx) => {
    await tx.revenueEstimateRow.deleteMany({});
    await tx.revenueEstimateRow.createMany({ data: normalized });
  });

  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } }
  );
}
