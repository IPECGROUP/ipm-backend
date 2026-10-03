import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { requirePagePermission } from "@/lib/pagePermissions";
import { safeOriginalName, validateUpload } from "@/lib/uploadSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  try {
    const denied = await requirePagePermission(request, "کاربرگ مالی", "صورت وضعیت‌ها");
    if (denied) return denied;

    const formData = await request.formData();
    const files = [...formData.getAll("file"), ...formData.getAll("files")]
      .filter((file) => file && typeof file.arrayBuffer === "function");
    if (!files.length) return json({ error: "no_file" }, 400);

    const directory = path.join(process.cwd(), "public", "uploads", "financial-worksheet");
    await mkdir(directory, { recursive: true });

    const items = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const checked = validateUpload({
        name: file.name,
        size: Number(file.size || 0),
        buffer,
        profile: "payment",
      });
      if (!checked.ok) return json({ error: checked.error }, 415);

      const storedName = `${crypto.randomUUID()}${checked.extension}`;
      await writeFile(path.join(directory, storedName), buffer);
      items.push({
        id: storedName,
        name: safeOriginalName(checked.originalName),
        size: Number(file.size || 0),
        type: checked.mimeType,
        url: `/uploads/financial-worksheet/${storedName}`,
      });
    }

    return json({ ok: true, items }, 201);
  } catch (error) {
    console.error("financial_worksheet_upload_error", error);
    return json({ error: "upload_failed" }, 500);
  }
}
