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
    const uploadDir = path.join(process.cwd(), "public", "uploads", "letters");
    await ensureDir(uploadDir);

    const ext = path.extname(file.name || "") || "";
    const fname = `${Date.now()}_${Math.random().toString(16).slice(2)}_${safeName(file.name || "file")}`;
    const finalName = ext && !fname.endsWith(ext) ? `${fname}${ext}` : fname;

    const absPath = path.join(uploadDir, finalName);
    await fs.writeFile(absPath, bytes);

    const url = `/uploads/letters/${finalName}`;

    const item = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      name: file.name || finalName,
      size: bytes.length,
      type: file.type || "",
      url,
      path: `public/uploads/letters/${finalName}`,
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
    return bad(e?.message || "upload_failed", 500);
  }
}
