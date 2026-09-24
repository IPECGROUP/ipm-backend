// app/api/upload/payment-doc/route.js
import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { requirePagePermission } from "../../../../lib/pagePermissions";
import { safeOriginalName, validateUpload } from "../../../../lib/uploadSecurity";

export const runtime = "nodejs";

const prisma = globalThis.__prisma_payment_upload || new PrismaClient();
if (process.env.NODE_ENV !== "production") globalThis.__prisma_payment_upload = prisma;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// همون نکته: با Auth خودت هماهنگ کن
function getUserId(req) {
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)user_id=([^;]+)/);
  const fromCookie = m ? decodeURIComponent(m[1]) : null;
  const fromHeader = req.headers.get("x-user-id");
  const idStr = fromHeader || fromCookie;
  if (idStr && String(idStr).match(/^\d+$/)) return Number(idStr);
  if (process.env.NODE_ENV !== "production") return 1;
  return null;
}

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "payment-doc");

function safeExtFromName(name = "") {
  const ext = path.extname(name).toLowerCase().slice(0, 10);
  if (!ext) return "";
  // اجازه بده فقط ext های معمول
  if (!/^\.[a-z0-9]+$/.test(ext)) return "";
  return ext;
}

export async function POST(req) {
  const denied = await requirePagePermission(req, "درخواست پرداخت", "افزودن");
  if (denied) return denied;
  const userId = getUserId(req);
  if (!userId) return json({ error: "unauthorized" }, 401);

  const form = await req.formData();

  // فرانت ممکنه اسم فیلدها رو "file" یا "files" بفرسته
  const candidates = [];
  for (const key of ["file", "files"]) {
    const v = form.getAll(key);
    if (v && v.length) candidates.push(...v);
  }

  const files = candidates.filter((x) => x && typeof x.arrayBuffer === "function");
  if (!files.length) return json({ error: "no_file" }, 400);

  await mkdir(UPLOAD_DIR, { recursive: true });

  // این endpoint ساده است: اولین فایل رو برمی‌گردونه (اگر چندتا زدی، می‌تونی حلقه رو خروجی آرایه کنی)
  const f = files[0];

  const size = Number(f.size || 0);

  // نام یکتا
  const buf = Buffer.from(await f.arrayBuffer());
  const checked = validateUpload({ name: f.name, size, buffer: buf, profile: "payment" });
  if (!checked.ok) return json({ error: checked.error }, 415);
  const originalName = safeOriginalName(f.name);
  const mimeType = checked.mimeType;
  const ext = checked.extension;
  const storedName = `${crypto.randomUUID()}${ext}`;

  await writeFile(path.join(UPLOAD_DIR, storedName), buf);

  const url = `/uploads/payment-doc/${storedName}`;

  const rec = await prisma.paymentDoc.create({
    data: {
      originalName,
      storedName,
      mimeType,
      size,
      url,
      uploadedById: userId,
    },
  });

  return json({
    ok: true,
    file: {
      serverId: rec.id,
      url: rec.url,
      name: rec.originalName,
      size: rec.size,
      type: rec.mimeType,
    },
  });
}
