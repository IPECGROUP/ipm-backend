import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { requirePagePermission } from "../../../../lib/pagePermissions";
import { safeOriginalName, validateUpload } from "../../../../lib/uploadSecurity";

export const runtime = "nodejs";

export async function POST(request) {
  const denied = await requirePagePermission(request, "تنخواه گردان", "افزودن");
  if (denied) return denied;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    return Response.json({ error: "no_file" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const checked = validateUpload({ name: file.name, size: file.size, buffer, profile: "payment" });
  if (!checked.ok) return Response.json({ error: checked.error }, { status: 415 });

  const storedName = `${randomUUID()}${checked.extension}`;
  const directory = path.join(process.cwd(), "public", "uploads", "petty-cash-expenses");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, storedName), buffer);
  return Response.json({
    file: { name: safeOriginalName(file.name), url: `/uploads/petty-cash-expenses/${storedName}` },
  });
}
