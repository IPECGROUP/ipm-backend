import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(message, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function uploadRootDir() {
  return process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(process.cwd(), "public", "uploads");
}

function filePathFromRecord(file) {
  const root = uploadRootDir();
  const rawUrl = String(file?.url || "").trim();
  if (rawUrl.startsWith("/uploads/")) {
    return path.join(root, decodeURIComponent(rawUrl.replace(/^\/uploads\/+/, "")));
  }

  const storedName = String(file?.storedName || "").trim();
  if (!storedName) return "";
  return path.join(root, "letters", storedName);
}

function assertInsideRoot(root, target) {
  const rel = path.relative(root, target);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export async function GET(_req, ctx) {
  const params = await ctx?.params;
  const id = Number(params?.id);
  if (!Number.isFinite(id) || id <= 0) return bad("invalid_file_id");

  const file = await prisma.uploadedFile.findUnique({ where: { id } });
  if (!file) return bad("file_not_found", 404);

  const root = uploadRootDir();
  const filePath = filePathFromRecord(file);
  if (!filePath || !assertInsideRoot(root, filePath)) return bad("invalid_file_path", 400);

  let bytes;
  try {
    bytes = await fs.readFile(filePath);
  } catch (e) {
    if (e?.code === "ENOENT") return bad("file_not_found_on_disk", 404);
    throw e;
  }

  const name = String(file.originalName || file.storedName || "file");
  const encodedName = encodeURIComponent(name).replace(/[!'()*]/g, (ch) =>
    `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": file.mimeType || "application/octet-stream",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
