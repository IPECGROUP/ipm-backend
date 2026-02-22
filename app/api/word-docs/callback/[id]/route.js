import { NextResponse } from "next/server";
import fs from "fs/promises";
import { getWordDoc, getWordDocPath, updateWordDocMeta } from "@/lib/wordDocsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

function ok() {
  // ONLYOFFICE requires this shape.
  return json({ error: 0 });
}

function bad(error, status = 400) {
  return json({ error }, status);
}

function getId(ctx) {
  return String(ctx?.params?.id || "").trim();
}

async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function shouldPersist(status) {
  const n = Number(status || 0);
  return n === 2 || n === 6;
}

export async function POST(req, ctx) {
  try {
    const id = getId(ctx);
    if (!id) return bad("missing_id");

    const item = await getWordDoc(id);
    if (!item) return bad("not_found", 404);

    const body = await readBody(req);
    if (!shouldPersist(body?.status)) return ok();

    const downloadUrl = String(body?.url || "").trim();
    if (!downloadUrl) return ok();

    const fp = getWordDocPath(id);
    if (!fp) return bad("not_found", 404);

    const r = await fetch(downloadUrl);
    if (!r.ok) return bad("download_failed", 502);
    const bytes = Buffer.from(await r.arrayBuffer());
    await fs.writeFile(fp, bytes);
    await updateWordDocMeta(id, { size: bytes.length, updatedAt: new Date().toISOString() });

    return ok();
  } catch (e) {
    return bad(e?.message || "request_failed", 500);
  }
}
