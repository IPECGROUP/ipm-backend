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

function allowedRoots() {
  return [
    process.env.LETTER_ATTACHMENTS_DIR,
    process.env.LEGACY_LETTERS_DIR,
    uploadRootDir(),
    path.join(process.cwd(), "public"),
  ]
    .filter(Boolean)
    .map((x) => path.resolve(String(x)));
}

function assertInsideRoot(root, target) {
  const rel = path.relative(root, target);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function isFile(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function stripUrlDecorations(raw) {
  const value = String(raw || "").trim().replace(/\\/g, "/");
  if (!value) return "";
  return value.split("#")[0].split("?")[0];
}

function safeDecode(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function attachmentRawPath(att) {
  return stripUrlDecorations(
    att?.url ??
      att?.href ??
      att?.path ??
      att?.file_path ??
      att?.filePath ??
      att?.public_url ??
      att?.publicUrl ??
      att?.file_url ??
      att?.fileUrl ??
      ""
  );
}

function attachmentName(att) {
  return String(
    att?.name ??
      att?.filename ??
      att?.file_name ??
      att?.fileName ??
      att?.original_name ??
      att?.originalName ??
      ""
  ).trim();
}

function contentTypeFor(name, hintedType = "") {
  const type = String(hintedType || "").trim();
  if (type && type !== "application/octet-stream") return type;

  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".pdf") || /^pdf[._-]/i.test(lower)) return "application/pdf";
  if (lower.endsWith(".docx") || /^docx[._-]/i.test(lower)) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".doc") || /^doc[._-]/i.test(lower)) return "application/msword";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}

function filePathFromUploadedFile(file) {
  const root = uploadRootDir();
  const rawUrl = String(file?.url || "").trim();
  if (rawUrl.startsWith("/uploads/")) {
    return path.join(root, safeDecode(rawUrl.replace(/^\/uploads\/+/, "")));
  }

  const storedName = String(file?.storedName || "").trim();
  if (!storedName) return "";
  return path.join(root, "letters", storedName);
}

function candidateRelativePaths(raw, name) {
  const values = [raw, name].map(stripUrlDecorations).filter(Boolean);
  const out = [];

  for (const value of values) {
    if (/^https?:\/\//i.test(value) || value.startsWith("//")) continue;

    const decoded = safeDecode(value).replace(/^public\//i, "");
    const noLead = decoded.replace(/^\/+/, "");
    const noUploads = noLead.replace(/^uploads\/+/i, "");

    out.push(noLead);
    out.push(noUploads);
    if (!/^letters\//i.test(noUploads)) out.push(path.posix.join("letters", noUploads));

    const lower = noLead.toLowerCase();
    if (/^pdf[._-]/.test(lower) && !lower.endsWith(".pdf")) {
      out.push(`${noUploads}.pdf`);
      if (!/^letters\//i.test(noUploads)) out.push(path.posix.join("letters", `${noUploads}.pdf`));
    }
    if (/^docx[._-]/.test(lower) && !lower.endsWith(".docx")) {
      out.push(`${noUploads}.docx`);
      if (!/^letters\//i.test(noUploads)) out.push(path.posix.join("letters", `${noUploads}.docx`));
    }
    if (/^doc[._-]/.test(lower) && !lower.endsWith(".doc")) {
      out.push(`${noUploads}.doc`);
      if (!/^letters\//i.test(noUploads)) out.push(path.posix.join("letters", `${noUploads}.doc`));
    }
  }

  return [...new Set(out.filter(Boolean))];
}

async function resolveLegacyPath(att) {
  const raw = attachmentRawPath(att);
  const name = attachmentName(att);
  const roots = allowedRoots();
  const candidates = [];

  if (raw && path.isAbsolute(raw)) candidates.push(path.resolve(raw));

  for (const rel of candidateRelativePaths(raw, name)) {
    for (const root of roots) {
      candidates.push(path.resolve(root, rel));
    }
  }

  for (const candidate of [...new Set(candidates)]) {
    const root = roots.find((r) => assertInsideRoot(r, candidate));
    if (root && (await isFile(candidate))) return candidate;
  }

  return "";
}

function encodeDispositionName(name) {
  return encodeURIComponent(name || "file").replace(/[!'()*]/g, (ch) =>
    `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function normalizeViewerName(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

function isConfidentialLabel(raw) {
  const v = normalizeViewerName(raw);
  return (
    v.includes("confidential") ||
    v.includes("secret") ||
    v.includes("محرمانه") ||
    v.includes("خيلي محرمانه")
  );
}

async function getUserIdFromReq(req) {
  try {
    const sid = String(
      req?.cookies?.get?.("ipm_session")?.value ||
        req?.cookies?.get?.("session_id")?.value ||
        req?.cookies?.get?.("session")?.value ||
        req?.cookies?.get?.("sid")?.value ||
        ""
    ).trim();

    if (sid) {
      const session = await prisma.session.findUnique({ where: { id: sid } });
      if (session) {
        const expiresAt = new Date(session.expiresAt).getTime();
        if (Number.isFinite(expiresAt) && expiresAt > Date.now()) return session.userId || null;
      }
    }
  } catch {}

  try {
    const header = String(req?.headers?.get?.("x-user-id") || req?.headers?.get?.("x-userid") || "").trim();
    const cookie = String(req?.cookies?.get?.("user_id")?.value || req?.cookies?.get?.("userid")?.value || "").trim();
    const raw = header || cookie;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function canReadLetter(req, letter) {
  const label =
    String(letter?.classificationLabel || "").trim() ||
    String(typeof letter?.classification === "object" ? letter?.classification?.label || "" : "").trim() ||
    String(letter?.docClass || "").trim();
  if (!isConfidentialLabel(label)) return true;

  const userId = await getUserIdFromReq(req);
  if (!userId) return false;

  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: { username: true, name: true },
  });
  const username = normalizeViewerName(user?.username || user?.name || "");
  return username === "marandi" || username === "rastegar";
}

async function findLetterForAttachment(letterId) {
  try {
    return await prisma.letter.findUnique({
      where: { id: letterId },
      select: {
        id: true,
        attachments: true,
        classificationLabel: true,
        docClass: true,
        classification: { select: { label: true } },
      },
    });
  } catch (err) {
    const msg = String(err?.message || "");
    const isCompat =
      err?.code === "P2021" ||
      err?.code === "P2022" ||
      msg.includes("Unknown field") ||
      msg.includes("does not exist") ||
      msg.includes("Unknown argument");
    if (!isCompat) throw err;
  }

  try {
    return await prisma.letter.findUnique({
      where: { id: letterId },
      select: {
        id: true,
        attachments: true,
        docClass: true,
      },
    });
  } catch (err) {
    const msg = String(err?.message || "");
    const isCompat =
      err?.code === "P2021" ||
      err?.code === "P2022" ||
      msg.includes("Unknown field") ||
      msg.includes("does not exist") ||
      msg.includes("Unknown argument");
    if (!isCompat) throw err;
  }

  return await prisma.letter.findUnique({
    where: { id: letterId },
    select: {
      id: true,
      attachments: true,
    },
  });
}

export async function GET(req, ctx) {
  const params = await ctx?.params;
  const letterId = Number(params?.letterId);
  const index = Number(params?.index);

  if (!Number.isFinite(letterId) || letterId <= 0) return bad("invalid_letter_id");
  if (!Number.isInteger(index) || index < 0) return bad("invalid_attachment_index");

  const letter = await findLetterForAttachment(letterId);
  if (!letter) return bad("not_found", 404);
  if (!(await canReadLetter(req, letter))) return bad("not_found", 404);

  const attachments = Array.isArray(letter.attachments) ? letter.attachments : [];
  const att = attachments[index];
  if (!att || typeof att !== "object") return bad("attachment_not_found", 404);

  let filePath = "";
  let fileRecord = null;
  const fileId = Number(att?.file_id ?? att?.fileId ?? att?.serverId);
  if (Number.isFinite(fileId) && fileId > 0) {
    fileRecord = await prisma.uploadedFile.findUnique({ where: { id: fileId } });
    if (fileRecord) {
      const candidate = filePathFromUploadedFile(fileRecord);
      const root = uploadRootDir();
      if (candidate && assertInsideRoot(root, candidate) && (await isFile(candidate))) filePath = candidate;
    }
  }

  if (!filePath) filePath = await resolveLegacyPath(att);
  if (!filePath) return bad("file_not_found_on_disk", 404);

  const bytes = await fs.readFile(filePath);
  const name = attachmentName(att) || fileRecord?.originalName || path.basename(filePath);
  const type = contentTypeFor(name || filePath, att?.type ?? att?.mime ?? att?.mimeType ?? fileRecord?.mimeType);
  const encodedName = encodeDispositionName(name || path.basename(filePath));

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
