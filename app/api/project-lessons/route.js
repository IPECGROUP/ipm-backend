import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (data, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
let schemaPromise;

async function currentUser(request) {
  const token = (request.headers.get("cookie") || "").match(/(?:^|;\s*)ipm_session=([^;]+)/)?.[1];
  if (token) {
    const session = await prisma.session.findUnique({ where: { id: decodeURIComponent(token) }, include: { user: true } }).catch(() => null);
    if (session?.user && (!session.expiresAt || new Date(session.expiresAt) >= new Date())) return session.user;
  }
  const id = request.headers.get("x-user-id");
  return process.env.NODE_ENV !== "production" && /^\d+$/.test(id || "") ? { id: Number(id) } : null;
}

async function ensureSchema() {
  if (!schemaPromise) schemaPromise = prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS project_lessons (
    id TEXT PRIMARY KEY, project_id INTEGER NOT NULL, category TEXT NOT NULL, challenge TEXT NOT NULL, solution TEXT NOT NULL,
    importance TEXT NOT NULL, impacts JSONB NOT NULL DEFAULT '[]'::jsonb, tag_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    files JSONB NOT NULL DEFAULT '[]'::jsonb, created_by_id INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`).catch((error) => { schemaPromise = null; throw error; });
  return schemaPromise;
}

const list = (value, max = 100) => [...new Set((Array.isArray(value) ? value : []).map(String).map((item) => item.trim()).filter(Boolean))].slice(0, max);
const filesOf = (value) => (Array.isArray(value) ? value : []).filter((file) => file && typeof file === "object" && file.url).slice(0, 30).map((file) => ({ name: String(file.name || "file").slice(0, 255), url: String(file.url).slice(0, 1000), size: Number(file.size || 0), type: String(file.type || "").slice(0, 120) }));
const mapItem = (row) => ({ id: row.id, projectId: row.project_id, projectName: row.project_name || "", projectCode: row.project_code || "", category: row.category, challenge: row.challenge, solution: row.solution, importance: row.importance, impacts: Array.isArray(row.impacts) ? row.impacts : [], tagIds: Array.isArray(row.tag_ids) ? row.tag_ids.map(String) : [], files: Array.isArray(row.files) ? row.files : [], createdAt: row.created_at });

export async function GET(request) {
  try {
    if (!await currentUser(request)) return json({ error: "unauthorized" }, 401);
    await ensureSchema();
    const rows = await prisma.$queryRawUnsafe(`SELECT l.*, p.name AS project_name, p.code AS project_code FROM project_lessons l LEFT JOIN projects p ON p.id=l.project_id ORDER BY l.created_at DESC`);
    return json({ items: rows.map(mapItem) });
  } catch (error) { console.error("project_lessons_get_failed", error); return json({ error: "project_lessons_get_failed" }, 500); }
}

export async function POST(request) {
  try {
    const user = await currentUser(request); if (!user) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const projectId = Number(body.projectId); const category = String(body.category || "").trim().slice(0, 200); const challenge = String(body.challenge || "").trim().slice(0, 5000); const solution = String(body.solution || "").trim().slice(0, 5000); const importance = String(body.importance || ""); const impacts = list(body.impacts, 10); const tagIds = list(body.tagIds);
    if (!Number.isInteger(projectId) || projectId <= 0 || !category || !challenge || !solution || !["low", "medium", "high"].includes(importance) || !impacts.length) return json({ error: "required_fields_missing" }, 400);
    const project = await prisma.project.findFirst({ where: { id: projectId, isActive: true } }); if (!project) return json({ error: "active_project_required" }, 400);
    await ensureSchema(); const id = randomUUID(); const files = filesOf(body.files);
    const rows = await prisma.$queryRaw`INSERT INTO project_lessons (id,project_id,category,challenge,solution,importance,impacts,tag_ids,files,created_by_id) VALUES (${id},${projectId},${category},${challenge},${solution},${importance},${JSON.stringify(impacts)}::jsonb,${JSON.stringify(tagIds)}::jsonb,${JSON.stringify(files)}::jsonb,${Number(user.id)}) RETURNING *`;
    return json({ item: mapItem({ ...rows[0], project_name: project.name, project_code: project.code }) }, 201);
  } catch (error) { console.error("project_lessons_post_failed", error); return json({ error: "project_lessons_post_failed" }, 500); }
}
