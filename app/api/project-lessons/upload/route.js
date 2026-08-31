import crypto from "node:crypto";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
export const runtime = "nodejs";
const json = (data, status = 200) => NextResponse.json(data, { status });
const extensions = new Set([".pdf", ".doc", ".docx", ".rtf", ".xls", ".xlsx", ".xlsm", ".csv"]);
async function authorized(request) { const token = (request.headers.get("cookie") || "").match(/(?:^|;\s*)ipm_session=([^;]+)/)?.[1]; if (token) { const session = await prisma.session.findUnique({ where: { id: decodeURIComponent(token) } }).catch(() => null); if (session && (!session.expiresAt || new Date(session.expiresAt) >= new Date())) return true; } return process.env.NODE_ENV !== "production" && /^\d+$/.test(request.headers.get("x-user-id") || ""); }
export async function POST(request) { try { if (!await authorized(request)) return json({ error: "unauthorized" }, 401); const file = (await request.formData()).get("file"); if (!file || typeof file.arrayBuffer !== "function") return json({ error: "no_file" }, 400); const name = String(file.name || "file"); const ext = path.extname(name).toLowerCase(); if (!extensions.has(ext)) return json({ error: "unsupported_file_type" }, 415); const stored = `${crypto.randomUUID()}${ext}`; const dir = path.join(process.cwd(), "public", "uploads", "project-lessons"); await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, stored), Buffer.from(await file.arrayBuffer())); return json({ file: { name, url: `/uploads/project-lessons/${stored}`, size: Number(file.size || 0), type: String(file.type || "application/octet-stream") } }, 201); } catch (error) { console.error("project_lesson_upload_failed", error); return json({ error: "upload_failed" }, 500); } }
