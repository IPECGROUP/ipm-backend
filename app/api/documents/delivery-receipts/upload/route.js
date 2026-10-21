import crypto from "node:crypto";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { validateUpload } from "../../../../../lib/uploadSecurity";

export const runtime = "nodejs";

const json = (body, status = 200) => NextResponse.json(body, { status });

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
    const buffer = Buffer.from(await file.arrayBuffer());
    const checked = validateUpload({ name: file.name, size: Number(file.size || 0), buffer, profile: "petty_cash" });
    if (!checked.ok) return json({ error: checked.error }, 415);
    const storedName = `${crypto.randomUUID()}${checked.extension}`;
    const directory = path.join(process.cwd(), "public", "uploads", "delivery-receipts");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, storedName), buffer);
    return json({ file: { name: checked.originalName, url: `/uploads/delivery-receipts/${storedName}`, size: Number(file.size || 0), type: checked.mimeType } }, 201);
  } catch (error) {
    console.error("delivery_receipt_upload_failed", error);
    return json({ error: "upload_failed" }, 500);
  }
}
