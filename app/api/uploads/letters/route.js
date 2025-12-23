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
    const hash = sha256(bytes);

    // 1) If already uploaded, reuse it (no re-write)
    let existing = await prisma.uploadedFile.findUnique({ where: { sha256: hash } });

    let storedName = "";
    let url = "";

    if (existing) {
      storedName = existing.storedName;
      url = existing.url;
    } else {
      // 2) Save new file
      const uploadRoot = process.env.UPLOADS_DIR
        ? path.resolve(process.env.UPLOADS_DIR)
        : path.join(process.cwd(), "public", "uploads");

      const uploadDir = path.join(uploadRoot, "letters");
      await ensureDir(uploadDir);

      storedName = makeFileName(file.name || "file");
      const absPath = path.join(uploadDir, storedName);

      await fs.writeFile(absPath, bytes);

      url = `/uploads/letters/${storedName}`;

      existing = await prisma.uploadedFile.create({
        data: {
          sha256: hash,
          originalName: file.name || storedName,
          storedName,
          mimeType: file.type || null,
          size: bytes.length,
          url,
          createdBy: null,
        },
      });
    }

    // 3) Attach to the letter by reference (file_id)
    const prev = Array.isArray(letter.attachments) ? letter.attachments : [];
    const nextItem = {
      file_id: existing.id,
      name: existing.originalName,
      size: existing.size,
      type: existing.mimeType || "",
      url: existing.url,
      uploaded_at: new Date().toISOString(),
    };

    // جلوگیری از attach تکراری به همین نامه
    const alreadyAttached = prev.some((x) => Number(x?.file_id) === existing.id);
    const next = alreadyAttached ? prev : [...prev, nextItem];

    await prisma.letter.update({
      where: { id: letterId },
      data: {
        attachments: next,
        hasAttachment: true,
      },
    });

    return json({ ok: true, file: existing, attachment: nextItem, url: existing.url });
  } catch (e) {
    console.error("[UPLOAD] failed", e);
    return bad(e?.message || "upload_failed", 500);
  }
}
