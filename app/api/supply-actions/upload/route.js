import { prisma } from "../../../../lib/prisma";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function readCookieValue(cookie, name) {
  const safe = String(name || "").replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const re = new RegExp(`(?:^|;\\s*)${safe}=([^;]+)`);
  const m = String(cookie || "").match(re);
  return m ? decodeURIComponent(m[1]) : null;
}

async function getUserId(req) {
  const cookie = req.headers.get("cookie") || "";
  const fromHeader = req.headers.get("x-user-id");
  const fromCookie = readCookieValue(cookie, "user_id");
  const direct = fromHeader || fromCookie;
  if (direct && /^\d+$/.test(String(direct))) return Number(direct);

  const sessionId = readCookieValue(cookie, "ipm_session");
  if (sessionId) {
    try {
      const session = await prisma.session.findFirst({
        where: { OR: [{ id: sessionId }, { token: sessionId }] },
      });
      if (session?.userId && (!session.expiresAt || new Date(session.expiresAt).getTime() >= Date.now())) {
        return Number(session.userId);
      }
    } catch {}
  }

  if (process.env.NODE_ENV !== "production") return 1;
  return null;
}

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "supply-actions");

function safeName(name = "") {
  return String(name || "file").replace(/[/\\?%#*:|"<>]/g, "_").slice(-180) || "file";
}

function safeExtFromName(name = "") {
  const ext = path.extname(name).toLowerCase().slice(0, 10);
  return /^\.[a-z0-9]+$/.test(ext) ? ext : "";
}

export async function POST(req) {
  try {
    const userId = await getUserId(req);
    if (!userId) return json({ error: "unauthorized" }, 401);

    const form = await req.formData();
    const candidates = [...form.getAll("file"), ...form.getAll("files")];
    const files = candidates.filter((file) => file && typeof file.arrayBuffer === "function");
    if (!files.length) return json({ error: "no_file" }, 400);

    await mkdir(UPLOAD_DIR, { recursive: true });

    const file = files[0];
    const originalName = safeName(file.name || "file");
    const mimeType = String(file.type || "application/octet-stream");
    const size = Number(file.size || 0);
    const buffer = Buffer.from(await file.arrayBuffer());
    const contentHash = crypto.createHash("sha256").update(buffer).digest("hex");
    const sha256 = `supply-actions:${contentHash}`;
    const ext = safeExtFromName(originalName);
    const storedName = `${crypto.randomUUID()}${ext}`;
    const url = `/uploads/supply-actions/${storedName}`;

    await writeFile(path.join(UPLOAD_DIR, storedName), buffer);

    const rec = await prisma.uploadedFile.upsert({
      where: { sha256 },
      update: {
        originalName,
        storedName,
        mimeType,
        size,
        url,
        createdBy: Number(userId),
      },
      create: {
        sha256,
        originalName,
        storedName,
        mimeType,
        size,
        url,
        createdBy: Number(userId),
      },
    });

    return json({
      ok: true,
      file: {
        id: rec.id,
        serverId: rec.id,
        url: rec.url,
        name: rec.originalName,
        size: rec.size,
        type: rec.mimeType || mimeType,
      },
    });
  } catch (error) {
    console.error("supply_actions_upload_error", error);
    return json({ error: "upload_failed" }, 500);
  }
}
