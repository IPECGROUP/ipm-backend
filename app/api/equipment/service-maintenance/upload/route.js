import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../../../../../lib/prisma";
import { safeOriginalName, validateUpload } from "../../../../../lib/uploadSecurity";

export const runtime = "nodejs";

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
    if (!await isAuthenticated(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file.arrayBuffer !== "function") return Response.json({ error: "no_file" }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const checked = validateUpload({ name: file.name, size: file.size, buffer, profile: "petty_cash" });
    if (!checked.ok) return Response.json({ error: checked.error }, { status: 415 });
    const storedName = `${randomUUID()}${checked.extension}`;
    const directory = path.join(process.cwd(), "public", "uploads", "equipment-service-maintenance");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, storedName), buffer);
    return Response.json({ file: { name: safeOriginalName(file.name), url: `/uploads/equipment-service-maintenance/${storedName}` } }, { status: 201 });
  } catch (error) {
    console.error("equipment_service_maintenance_upload_failed", error);
    return Response.json({ error: "upload_failed" }, { status: 500 });
  }
}
