import crypto from "node:crypto";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

const allowedExtensions = new Set([".pdf", ".doc", ".docx", ".rtf", ".xls", ".xlsx", ".xlsm", ".csv"]);
const json = (data, status = 200) => NextResponse.json(data, { status });

async function isAuthenticated(request) {
  const cookie = request.headers.get("cookie") || "";
  const token = cookie.match(/(?:^|;\s*)ipm_session=([^;]+)/)?.[1];
  if (token) {
    const session = await prisma.session.findUnique({ where: { id: decodeURIComponent(token) } }).catch(() => null);
    if (session && (!session.expiresAt || new Date(session.expiresAt) >= new Date())) return true;
  }
  return process.env.NODE_ENV !== "production" && /^\d+$/.test(request.headers.get("x-user-id") || "");
}

export async function POST(request) {
  try {
    if (!await isAuthenticated(request)) return json({ error: "unauthorized" }, 401);
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function") return json({ error: "no_file" }, 400);
    const originalName = String(file.name || "file");
    const extension = path.extname(originalName).toLowerCase();
    if (!allowedExtensions.has(extension)) return json({ error: "unsupported_file_type" }, 415);
    if (Number(file.size || 0) > 25 * 1024 * 1024) return json({ error: "file_too_large" }, 413);
    const storedName = `${crypto.randomUUID()}${extension}`;
    const directory = path.join(process.cwd(), "public", "uploads", "training-resources");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, storedName), Buffer.from(await file.arrayBuffer()));
    return json({ file: { name: originalName, url: `/uploads/training-resources/${storedName}`, size: Number(file.size || 0), type: String(file.type || "application/octet-stream") } }, 201);
  } catch (error) {
    console.error("training_resource_upload_failed", error);
    return json({ error: "upload_failed" }, 500);
  }
}
