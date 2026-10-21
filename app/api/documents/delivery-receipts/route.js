import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let schemaPromise;
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function currentUser(request) {
  const cookie = request.headers.get("cookie") || "";
  const token = cookie.match(/(?:^|;\s*)ipm_session=([^;]+)/)?.[1];
  if (token) {
    const session = await prisma.session.findUnique({ where: { id: decodeURIComponent(token) }, include: { user: true } }).catch(() => null);
    if (session?.user && (!session.expiresAt || new Date(session.expiresAt) >= new Date())) return session.user;
  }
  const headerId = request.headers.get("x-user-id");
  if (process.env.NODE_ENV !== "production" && /^\d+$/.test(headerId || "")) return { id: Number(headerId) };
  return null;
}

async function ensureSchema() {
  if (!schemaPromise) schemaPromise = prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS delivery_receipts (
      id TEXT PRIMARY KEY,
      date_fa TEXT NOT NULL,
      receipt_type TEXT NOT NULL,
      title TEXT NOT NULL,
      recipient TEXT NOT NULL,
      files JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).then(() => prisma.$executeRawUnsafe(`ALTER TABLE delivery_receipts ADD COLUMN IF NOT EXISTS files JSONB NOT NULL DEFAULT '[]'::jsonb`)).catch((error) => { schemaPromise = null; throw error; });
  return schemaPromise;
}

const mapItem = (row) => ({ id: row.id, date: row.date_fa, type: row.receipt_type, title: row.title, recipient: row.recipient, files: Array.isArray(row.files) ? row.files : [], createdAt: row.created_at });

export async function GET(request) {
  try {
    if (!await currentUser(request)) return json({ error: "unauthorized" }, 401);
    await ensureSchema();
    const rows = await prisma.$queryRaw`SELECT * FROM delivery_receipts ORDER BY created_at DESC, id DESC`;
    return json({ items: rows.map(mapItem) });
  } catch (error) {
    console.error("delivery_receipts_get_failed", error);
    return json({ error: "delivery_receipts_get_failed" }, 500);
  }
}

export async function POST(request) {
  try {
    const user = await currentUser(request);
    if (!user) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const date = String(body.date || "").trim().replaceAll("-", "/");
    const type = String(body.type || "").trim();
    const title = String(body.title || "").trim();
    const recipient = String(body.recipient || "").trim();
    const files = (Array.isArray(body.files) ? body.files : []).slice(0, 30).map((file) => ({
      name: String(file?.name || "").slice(0, 180),
      url: String(file?.url || ""),
      size: Number(file?.size || 0),
      type: String(file?.type || "").slice(0, 120),
    }));
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(date) || !type || type.length > 100 || !title || title.length > 300 || !recipient || recipient.length > 200 || files.some((file) => !/^\/uploads\/delivery-receipts\/[a-f0-9-]{36}\.[a-z0-9]+$/.test(file.url) || !Number.isFinite(file.size) || file.size < 0)) return json({ error: "invalid_delivery_receipt" }, 400);
    await ensureSchema();
    const id = randomUUID();
    const rows = await prisma.$queryRaw`
      INSERT INTO delivery_receipts (id, date_fa, receipt_type, title, recipient, files, created_by_id)
      VALUES (${id}, ${date}, ${type}, ${title}, ${recipient}, ${JSON.stringify(files)}::jsonb, ${Number(user.id)})
      RETURNING *
    `;
    return json({ item: mapItem(rows[0]) }, 201);
  } catch (error) {
    console.error("delivery_receipts_post_failed", error);
    return json({ error: "delivery_receipts_post_failed" }, 500);
  }
}
