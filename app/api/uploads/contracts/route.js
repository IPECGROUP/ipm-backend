import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

function bad(message, status = 400) {
  return json({ error: message }, status);
}

function safeName(name) {
  const base = String(name || "file").replace(/[/\\?%#*:|"<>]/g, "_");
  return base.length > 180 ? base.slice(-180) : base;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function makeFileName(originalName) {
  const original = safeName(originalName || "file");
  const ext = (path.extname(original) || "").toLowerCase();
  const baseNoExt = ext ? original.slice(0, -ext.length) : original;
  return `${Date.now()}_${Math.random().toString(16).slice(2)}_${safeName(baseNoExt)}${ext}`;
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function uploadRootDir() {
  return process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(process.cwd(), "public", "uploads");
}

export async function POST(req) {
  try {
    const fd = await req.formData();
    const files = [...fd.getAll("files"), ...fd.getAll("file")].filter((f) => f && typeof f.arrayBuffer === "function");
    if (!files.length) return bad("missing_file");

    const uploadDir = path.join(uploadRootDir(), "contracts");
    await ensureDir(uploadDir);

    const uploaded = [];

    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const hash = sha256(bytes);
      let existing = await prisma.uploadedFile.findUnique({ where: { sha256: hash } });

      if (!existing) {
        const storedName = makeFileName(file.name || "file");
        const absPath = path.join(uploadDir, storedName);
        await fs.writeFile(absPath, bytes);

        existing = await prisma.uploadedFile.create({
          data: {
            sha256: hash,
            originalName: file.name || storedName,
            storedName,
            mimeType: file.type || null,
            size: bytes.length,
            url: `/uploads/contracts/${storedName}`,
            createdBy: null,
          },
        });
      }

      uploaded.push({
        id: existing.id,
        serverId: existing.id,
        name: existing.originalName,
        size: existing.size,
        type: existing.mimeType || "",
        url: existing.url,
        addedAt: new Date().toISOString(),
      });
    }

    return json({ items: uploaded }, 201);
  } catch (error) {
    console.error("contracts_upload_error", error);
    return bad(error?.message || "upload_failed", 500);
  }
}
