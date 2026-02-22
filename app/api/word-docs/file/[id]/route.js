import { NextResponse } from "next/server";
import fs from "fs/promises";
import { getWordDoc, getWordDocPath } from "@/lib/wordDocsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(error, status = 400) {
  return NextResponse.json({ error }, { status });
}

function getId(ctx) {
  return String(ctx?.params?.id || "").trim();
}

export async function GET(req, ctx) {
  try {
    const id = getId(ctx);
    if (!id) return bad("missing_id");

    const item = await getWordDoc(id);
    if (!item) return bad("not_found", 404);

    const fp = getWordDocPath(id);
    if (!fp) return bad("not_found", 404);
    const bytes = await fs.readFile(fp);

    const filename = `${String(item.title || "document").replace(/[^\w\u0600-\u06FF.-]+/g, "_")}.docx`;
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return bad(e?.message || "request_failed", 500);
  }
}
