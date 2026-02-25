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

function getUserIdFromReq(req) {
  try {
    const h =
      (req?.headers?.get?.("x-user-id") || req?.headers?.get?.("x-userid") || "")
        .toString()
        .trim();
    const c =
      (req?.cookies?.get?.("user_id")?.value ||
        req?.cookies?.get?.("userid")?.value ||
        "")
        .toString()
        .trim();
    const raw = h || c;
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function safeName(name) {
  const base = String(name || "file").replace(/[/\\?%*:|"<>]/g, "_");
  return base.length > 180 ? base.slice(-180) : base;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function makeFileName(originalName) {
  const original = safeName(originalName || "file");
  const ext = (path.extname(original) || "").toLowerCase();
  const baseNoExt = ext ? original.slice(0, -ext.length) : original;
  const rand = Math.random().toString(16).slice(2);
  const stamp = Date.now();
  return `${stamp}_${rand}_${safeName(baseNoExt)}${ext}`;
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export async function POST(req) {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return bad("unauthorized", 401);

    const fd = await req.formData();
    const files = [
      ...fd.getAll("files"),
      ...fd.getAll("file"),
    ].filter((f) => f && typeof f.arrayBuffer === "function");

    if (!files.length) return bad("missing_file");

    const uploadRoot = process.env.UPLOADS_DIR
      ? path.resolve(process.env.UPLOADS_DIR)
      : path.join(process.cwd(), "public", "uploads");
    const uploadDir = path.join(uploadRoot, "roznegar");
    await ensureDir(uploadDir);

    const uploaded = [];

    for (const f of files) {
      const bytes = Buffer.from(await f.arrayBuffer());
      const hash = sha256(bytes);

      let existing = await prisma.uploadedFile.findUnique({ where: { sha256: hash } });

      if (!existing) {
        const storedName = makeFileName(f.name || "file");
        const absPath = path.join(uploadDir, storedName);
        await fs.writeFile(absPath, bytes);

        const url = `/uploads/roznegar/${storedName}`;
        existing = await prisma.uploadedFile.create({
          data: {
            sha256: hash,
            originalName: f.name || storedName,
            storedName,
            mimeType: f.type || null,
            size: bytes.length,
            url,
            createdBy: userId,
          },
        });
      }

      uploaded.push({
        serverId: existing.id,
        name: existing.originalName,
        size: existing.size,
        type: existing.mimeType || "",
        url: existing.url,
        lastModified: Number(f.lastModified || Date.now()) || Date.now(),
      });
    }

    return json({ items: uploaded }, 201);
  } catch (e) {
    console.error("roznegar_upload_error", e);
    return bad(e?.message || "upload_failed", 500);
  }
}
