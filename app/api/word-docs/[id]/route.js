import { NextResponse } from "next/server";
import fs from "fs/promises";
import { deleteWordDoc, getWordDoc, getWordDocPath, updateWordDocMeta } from "@/lib/wordDocsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data, status = 200) {
  return NextResponse.json(data, { status });
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

export async function GET(req, ctx) {
  try {
    const id = getId(ctx);
    if (!id) return bad("missing_id");
    const item = await getWordDoc(id);
    if (!item) return bad("not_found", 404);
    return json({ item });
  } catch (e) {
    return bad(e?.message || "request_failed", 500);
  }
}

export async function PATCH(req, ctx) {
  try {
    const id = getId(ctx);
    if (!id) return bad("missing_id");
    const body = await readBody(req);
    const title = String(body?.title || "").trim();
    if (!title) return bad("missing_title");

    const item = await updateWordDocMeta(id, { title });
    if (!item) return bad("not_found", 404);
    return json({ item });
  } catch (e) {
    return bad(e?.message || "request_failed", 500);
  }
}

export async function DELETE(req, ctx) {
  try {
    const id = getId(ctx);
    if (!id) return bad("missing_id");
    const ok = await deleteWordDoc(id);
    if (!ok) return bad("not_found", 404);

    const fp = getWordDocPath(id);
    if (fp) {
      try {
        await fs.unlink(fp);
      } catch {}
    }
    return json({ ok: true });
  } catch (e) {
    return bad(e?.message || "request_failed", 500);
  }
}
