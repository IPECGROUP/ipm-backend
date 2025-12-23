import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();

  const items = await prisma.uploadedFile.findMany({
    where: q
      ? {
          OR: [
            { originalName: { contains: q, mode: "insensitive" } },
            { storedName: { contains: q, mode: "insensitive" } },
          ],
        }
      : {},
    orderBy: { id: "desc" },
    take: 50,
  });

  return json({
    items: items.map((f) => ({
      id: f.id,
      name: f.originalName,
      size: f.size,
      type: f.mimeType || "",
      url: f.url,
      sha256: f.sha256,
      created_at: f.createdAt,
    })),
  });
}
    