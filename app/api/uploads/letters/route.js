import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

function bad(message, status = 400) {
  return json({ error: message }, status);
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

  // اسم نهایی: 1766..._abcd_originalName.png
  return `${stamp}_${rand}_${safeName(baseNoExt)}${ext}`;
}

export async function POST(req) {
  try {
    // --- Debug / trace: مطمئن می‌شیم route واقعاً hit میشه
    console.log("[UPLOAD] hit", {
      time: new Date().toISOString(),
      cwd: process.cwd(),
      uploadsDirEnv: process.env.UPLOADS_DIR || "",
    });

    const fd = await req.formData();

    const file = fd.get("file");
    const letterIdRaw = fd.get("letter_id") ?? fd.get("letterId");

    if (!letterIdRaw) return bad("missing_letter_id");
    const letterId = Number(letterIdRaw);
    if (!Number.isFinite(letterId) || letterId <= 0) return bad("invalid_letter_id");

    if (!file || typeof file.arrayBuffer !== "function") return bad("missing_file");

    const letter = await prisma.letter.findUnique({ where: { id: letterId } });
    if (!letter) return bad("letter_not_found", 404);

    const bytes = Buffer.from(await file.arrayBuffer());

    // ✅ مسیر پایدار: /uploads/letters (با env و volume)
    const uploadRoot = process.env.UPLOADS_DIR
      ? path.resolve(process.env.UPLOADS_DIR)
      : path.join(process.cwd(), "public", "uploads");

    const uploadDir = path.join(uploadRoot, "letters");
    await ensureDir(uploadDir);

    console.log("[UPLOAD] saving to", uploadDir);

    const finalName = makeFileName(file.name || "file");
    const absPath = path.join(uploadDir, finalName);

    await fs.writeFile(absPath, bytes);

    // این url برای دانلود/نمایش در مرورگر استفاده میشه (با nginx سرو می‌کنی)
    const url = `/uploads/letters/${finalName}`;

    const item = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      name: file.name || finalName,
      size: bytes.length,
      type: file.type || "",
      url,
      // مسیر داخلی برای دیباگ/اطلاعات (نه برای UI)
      path: path.join("uploads", "letters", finalName),
      uploaded_at: new Date().toISOString(),
    };

    const prev = Array.isArray(letter.attachments) ? letter.attachments : [];
    const next = [...prev, item];

    await prisma.letter.update({
      where: { id: letterId },
      data: {
        attachments: next,
        hasAttachment: true,
      },
    });

    return json({ ok: true, item, url });
  } catch (e) {
    console.error("[UPLOAD] failed", e);
    return bad(e?.message || "upload_failed", 500);
  }
}
