import { prisma } from "../../../lib/prisma";
import { getCurrentUser, ensureProjectLessonsSchema, noStoreJson as json } from "../project-lessons/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let schemaPromise;

async function ensureKnowledgeSchemas() {
  if (!schemaPromise) schemaPromise = (async () => {
    await ensureProjectLessonsSchema();
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS base_libraries (id SERIAL PRIMARY KEY, title TEXT NOT NULL UNIQUE, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS library_items (id TEXT PRIMARY KEY, title TEXT NOT NULL, library_id INTEGER NOT NULL, related_letter_ids JSONB NOT NULL DEFAULT '[]'::jsonb, tag_ids JSONB NOT NULL DEFAULT '[]'::jsonb, files JSONB NOT NULL DEFAULT '[]'::jsonb, created_by_id INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS training_resources (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', link TEXT NOT NULL, related_letter_ids JSONB NOT NULL DEFAULT '[]'::jsonb, tag_ids JSONB NOT NULL DEFAULT '[]'::jsonb, files JSONB NOT NULL DEFAULT '[]'::jsonb, created_by_id INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS knowledge_page_visits (id BIGSERIAL PRIMARY KEY, page_key TEXT NOT NULL, user_id INTEGER NOT NULL, visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  })().catch((error) => { schemaPromise = null; throw error; });
  return schemaPromise;
}

const number = (value) => Number(value || 0);
const nameOf = (row) => row.name || row.username || `کاربر #${row.user_id}`;

export async function GET(request) {
  try {
    if (!await getCurrentUser(request)) return json({ error: "unauthorized" }, 401);
    await ensureKnowledgeSchemas();
    const [lessons, libraries, resources, lessonVisits, resourceVisits] = await Promise.all([
      prisma.$queryRaw`SELECT l.project_id, l.category, l.importance, l.created_by_id, p.name AS project_name, u.name, u.username FROM project_lessons l LEFT JOIN projects p ON p.id=l.project_id LEFT JOIN "User" u ON u.id=l.created_by_id`,
      prisma.$queryRaw`SELECT l.title AS library_title, COUNT(i.id)::int AS count FROM base_libraries l LEFT JOIN library_items i ON i.library_id=l.id GROUP BY l.id, l.title ORDER BY l.title`,
      prisma.$queryRaw`SELECT category FROM training_resources`,
      prisma.$queryRaw`SELECT v.user_id, u.name, u.username, COUNT(*)::int AS count FROM knowledge_page_visits v LEFT JOIN "User" u ON u.id=v.user_id WHERE v.page_key='lessons' GROUP BY v.user_id, u.name, u.username ORDER BY count DESC, v.user_id ASC LIMIT 3`,
      prisma.$queryRaw`SELECT v.user_id, u.name, u.username, COUNT(*)::int AS count FROM knowledge_page_visits v LEFT JOIN "User" u ON u.id=v.user_id WHERE v.page_key='training' GROUP BY v.user_id, u.name, u.username ORDER BY count DESC, v.user_id ASC LIMIT 3`,
    ]);
    const grouped = (rows, key, fallback) => Object.values(rows.reduce((result, row) => { const label = String(row[key] || fallback).trim() || fallback; result[label] = { label, count: number(result[label]?.count) + 1 }; return result; }, {}));
    const authors = Object.values(lessons.reduce((result, row) => { const id = String(row.created_by_id || "unknown"); const current = result[id] || { id, name: nameOf(row), count: 0 }; current.count += 1; result[id] = current; return result; }, {})).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "fa"));
    const projects = Object.values(lessons.reduce((result, row) => { const id = String(row.project_id || "unknown"); const current = result[id] || { id, label: row.project_name || "بدون پروژه", count: 0 }; current.count += 1; result[id] = current; return result; }, {}));
    return json({
      lessons: { total: lessons.length, authors: authors.length, topAuthors: authors.slice(0, 3), byProject: projects, byCategory: grouped(lessons, "category", "بدون دسته‌بندی"), byImportance: grouped(lessons, "importance", "نامشخص") },
      libraries: libraries.map((row) => ({ label: row.library_title || "بدون عنوان", count: number(row.count) })),
      resources: { total: resources.length, byCategory: grouped(resources, "category", "بدون دسته‌بندی") },
      visits: { lessons: lessonVisits.map((row) => ({ id: row.user_id, name: nameOf(row), count: number(row.count) })), training: resourceVisits.map((row) => ({ id: row.user_id, name: nameOf(row), count: number(row.count) })) },
    });
  } catch (error) { console.error("knowledge_dashboard_get_failed", error); return json({ error: "knowledge_dashboard_get_failed" }, 500); }
}

export async function POST(request) {
  try {
    const user = await getCurrentUser(request);
    if (!user) return json({ error: "unauthorized" }, 401);
    const page = String((await request.json().catch(() => ({}))).page || "");
    if (!['lessons', 'training'].includes(page)) return json({ error: "invalid_page" }, 400);
    await ensureKnowledgeSchemas();
    await prisma.$executeRaw`INSERT INTO knowledge_page_visits (page_key, user_id) VALUES (${page}, ${Number(user.id)})`;
    return json({ ok: true }, 201);
  } catch (error) { console.error("knowledge_dashboard_visit_failed", error); return json({ error: "knowledge_dashboard_visit_failed" }, 500); }
}
