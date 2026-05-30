import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import crypto from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import Busboy from "next/dist/compiled/busboy/index.js";

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

function requestHeaders(req) {
  const headers = {};
  for (const [key, value] of req.headers.entries()) headers[key.toLowerCase()] = value;
  return headers;
}

function uploadRootDir() {
  return process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(process.cwd(), "public", "uploads");
}

async function removeFileIfExists(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (e) {
    if (e?.code !== "ENOENT") throw e;
  }
}

function parseMultipartUpload(req, uploadDir) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = [];
    const pendingWrites = [];
    const tempPaths = [];
    let settled = false;

    const fail = async (err) => {
      if (settled) return;
      settled = true;
      await Promise.allSettled(tempPaths.map(removeFileIfExists));
      reject(err);
    };

    let bb;
    try {
      bb = Busboy({
        headers: requestHeaders(req),
        limits: {
          fieldSize: Number.MAX_SAFE_INTEGER,
          fileSize: Number.MAX_SAFE_INTEGER,
          fields: Number.MAX_SAFE_INTEGER,
          files: Number.MAX_SAFE_INTEGER,
          parts: Number.MAX_SAFE_INTEGER,
        },
      });
    } catch (e) {
      reject(e);
      return;
    }

    bb.on("field", (name, value) => {
      fields[name] = value;
    });

    bb.on("file", (name, fileStream, info = {}) => {
      const originalName = info.filename || "file";
      const mimeType = info.mimeType || "";
      const tempName = `${Date.now()}_${Math.random().toString(16).slice(2)}.uploading`;
      const tempPath = path.join(uploadDir, tempName);
      const hash = crypto.createHash("sha256");
      let size = 0;

      tempPaths.push(tempPath);

      fileStream.on("data", (chunk) => {
        size += chunk.length;
        hash.update(chunk);
      });

      const writePromise = pipeline(fileStream, createWriteStream(tempPath)).then(() => {
        files.push({
          fieldName: name,
          originalName,
          mimeType,
          tempPath,
          size,
          sha256: hash.digest("hex"),
        });
      });

      pendingWrites.push(writePromise);
      writePromise.catch(fail);
    });

    bb.on("error", fail);

    bb.on("close", async () => {
      if (settled) return;
      try {
        await Promise.all(pendingWrites);
        settled = true;
        resolve({ fields, files });
      } catch (e) {
        await fail(e);
      }
    });

    const body = req.body;
    if (!body) {
      fail(new Error("missing_request_body"));
      return;
    }

    Readable.fromWeb(body).pipe(bb);
  });
}

export async function POST(req) {
  let tempPathToClean = "";
  try {
    const uploadDir = path.join(uploadRootDir(), "letters");
    await ensureDir(uploadDir);

    const { fields, files } = await parseMultipartUpload(req, uploadDir);
    const file = files.find((x) => x.fieldName === "file") || files[0];
    tempPathToClean = file?.tempPath || "";
    const letterIdRaw = fields.letter_id ?? fields.letterId;
    const cleanupAndBad = async (message, status = 400) => {
      await removeFileIfExists(tempPathToClean);
      tempPathToClean = "";
      return bad(message, status);
    };

    if (!letterIdRaw) return cleanupAndBad("missing_letter_id");
    const letterId = Number(letterIdRaw);
    if (!Number.isFinite(letterId) || letterId <= 0) return cleanupAndBad("invalid_letter_id");

    if (!file) return cleanupAndBad("missing_file");

    const letter = await prisma.letter.findUnique({ where: { id: letterId } });
    if (!letter) return cleanupAndBad("letter_not_found", 404);

    // 1) If already uploaded, reuse it (no re-write)
    let existing = await prisma.uploadedFile.findUnique({ where: { sha256: file.sha256 } });

    let storedName = "";
    let url = "";

    if (existing) {
      await removeFileIfExists(file.tempPath);
      tempPathToClean = "";
      storedName = existing.storedName;
      url = existing.url;
    } else {
      // 2) Save new file
      storedName = makeFileName(file.originalName || "file");
      const absPath = path.join(uploadDir, storedName);

      await fs.rename(file.tempPath, absPath);
      tempPathToClean = "";

      url = `/uploads/letters/${storedName}`;

      existing = await prisma.uploadedFile.create({
        data: {
          sha256: file.sha256,
          originalName: file.originalName || storedName,
          storedName,
          mimeType: file.mimeType || null,
          size: file.size,
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

    return json({
      ok: true,
      id: existing.id,
      url: existing.url,
      file: existing,
      item: {
        id: existing.id,
        url: existing.url,
        name: existing.originalName,
        type: existing.mimeType || "",
        size: existing.size,
      },
      attachment: nextItem,
      attachments: next,
    });
  } catch (e) {
    console.error("[UPLOAD] failed", e);
    await removeFileIfExists(tempPathToClean);
    return bad(e?.message || "upload_failed", 500);
  }
}
