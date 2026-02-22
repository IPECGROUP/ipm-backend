import { NextResponse } from "next/server";
import fs from "fs/promises";
import { Document, Packer, Paragraph } from "docx";
import { createWordDocMeta, getWordDocPath, listWordDocs, updateWordDocMeta } from "@/lib/wordDocsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

function bad(error, status = 400) {
  return json({ error }, status);
}

async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    const items = await listWordDocs();
    return json({ items });
  } catch (e) {
    return bad(e?.message || "request_failed", 500);
  }
}

export async function POST(req) {
  try {
    const body = await readBody(req);
    const title = String(body?.title || "").trim() || "New document";

    const meta = await createWordDocMeta(title);
    const fp = getWordDocPath(meta.id);
    if (!fp) return bad("invalid_id");

    const doc = new Document({
      sections: [{ children: [new Paragraph("")] }],
    });
    const buffer = await Packer.toBuffer(doc);
    await fs.writeFile(fp, Buffer.from(buffer));

    const updated = await updateWordDocMeta(meta.id, { size: buffer.length });
    return json({ item: updated || meta }, 201);
  } catch (e) {
    return bad(e?.message || "request_failed", 500);
  }
}
