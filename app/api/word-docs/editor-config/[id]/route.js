import { NextResponse } from "next/server";
import { getWordDoc } from "@/lib/wordDocsStore";

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

function trimSlash(v) {
  return String(v || "").replace(/\/+$/, "");
}

function getOrigin(req) {
  try {
    return new URL(req.url).origin;
  } catch {
    return "http://localhost:3000";
  }
}

export async function GET(req, ctx) {
  try {
    const id = getId(ctx);
    if (!id) return bad("missing_id");

    const item = await getWordDoc(id);
    if (!item) return bad("not_found", 404);

    const docServerUrl = trimSlash(process.env.ONLYOFFICE_SERVER_URL || "http://localhost:8082");
    const appBase = trimSlash(process.env.ONLYOFFICE_APP_BASE_URL || getOrigin(req));
    const rev = Date.parse(item.updatedAt || item.createdAt || new Date().toISOString()) || Date.now();
    const key = `${id}-${rev}`.slice(0, 120);

    const fileUrl = `${appBase}/api/word-docs/file/${id}?v=${rev}`;
    const callbackUrl = `${appBase}/api/word-docs/callback/${id}`;
    const title = `${String(item.title || "document").slice(0, 150)}.docx`;

    const config = {
      documentType: "word",
      type: "desktop",
      width: "100%",
      height: "100%",
      document: {
        fileType: "docx",
        key,
        title,
        url: fileUrl,
      },
      editorConfig: {
        callbackUrl,
        mode: "edit",
        lang: "fa",
        customization: {
          autosave: true,
          forcesave: true,
          toolbarNoTabs: false,
          compactToolbar: false,
        },
      },
    };

    return json({ documentServerUrl: docServerUrl, config, item });
  } catch (e) {
    return bad(e?.message || "request_failed", 500);
  }
}
