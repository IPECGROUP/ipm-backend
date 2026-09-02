import { randomUUID } from "node:crypto";
import { prisma } from "../../../lib/prisma";
import {
  ensureProjectLessonsSchema as ensureSchema,
  getCurrentUser as currentUser,
  isManagementAppointee,
  noStoreJson as json,
} from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const list = (value, max = 100) =>
  [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, max);
const filesOf = (value) =>
  (Array.isArray(value) ? value : [])
    .filter((file) => file && typeof file === "object" && file.url)
    .slice(0, 30)
    .map((file) => ({
      name: String(file.name || "file").slice(0, 255),
      url: String(file.url).slice(0, 1000),
      size: Number(file.size || 0),
      type: String(file.type || "").slice(0, 120),
    }));
const mapItem = (row) => ({
  id: row.id,
  projectId: row.project_id,
  projectName: row.project_name || "",
  projectCode: row.project_code || "",
  category: row.category,
  challenge: row.challenge,
  solution: row.solution,
  importance: row.importance,
  impacts: Array.isArray(row.impacts) ? row.impacts : [],
  tagIds: Array.isArray(row.tag_ids) ? row.tag_ids.map(String) : [],
  files: Array.isArray(row.files) ? row.files : [],
  authorId: row.created_by_id,
  authorName: row.author_name || row.author_username || "—",
  authorPostCount: Number(row.author_post_count || 0),
  viewCount: Number(row.view_count || 0),
  status: row.status || "approved",
  isUnread: Boolean(row.is_unread),
  createdAt: row.created_at,
});

const parseLesson = (body) => ({
  projectId: Number(body.projectId),
  category: String(body.category || "")
    .trim()
    .slice(0, 200),
  challenge: String(body.challenge || "")
    .trim()
    .slice(0, 5000),
  solution: String(body.solution || "")
    .trim()
    .slice(0, 5000),
  importance: String(body.importance || ""),
  impacts: list(body.impacts, 10),
  tagIds: list(body.tagIds),
  files: filesOf(body.files),
});
const validLesson = (lesson) =>
  Number.isInteger(lesson.projectId) &&
  lesson.projectId > 0 &&
  lesson.category &&
  lesson.challenge &&
  lesson.solution &&
  ["low", "medium", "high"].includes(lesson.importance) &&
  lesson.impacts.length &&
  lesson.tagIds.length;

async function activeProject(projectId) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, isActive: true },
  });
  return project && /^\d{3}$/.test(String(project.code || "").trim())
    ? project
    : null;
}

async function enrichedRow(row, project) {
  const creatorId = Number(row.created_by_id);
  const [creator, postCountRows] = await Promise.all([
    Number.isInteger(creatorId)
      ? prisma.user.findUnique({
          where: { id: creatorId },
          select: { name: true, username: true },
        })
      : null,
    Number.isInteger(creatorId)
      ? prisma.$queryRaw`SELECT COUNT(*) AS count FROM project_lessons WHERE created_by_id=${creatorId} AND status='approved'`
      : [],
  ]);
  return mapItem({
    ...row,
    project_name: project?.name,
    project_code: project?.code,
    author_name: creator?.name,
    author_username: creator?.username,
    author_post_count: postCountRows[0]?.count || 0,
  });
}

export async function GET(request) {
  try {
    const user = await currentUser(request);
    if (!user) return json({ error: "unauthorized" }, 401);
    await ensureSchema();
    const canReview = await isManagementAppointee(user.id);
    const rows = await prisma.$queryRaw`
      SELECT l.*, p.name AS project_name, p.code AS project_code, u.name AS author_name, u.username AS author_username,
        (SELECT COUNT(*) FROM project_lessons x WHERE x.created_by_id=l.created_by_id AND x.status='approved') AS author_post_count,
        (l.status='pending' AND v.lesson_id IS NULL) AS is_unread
      FROM project_lessons l
      LEFT JOIN projects p ON p.id=l.project_id
      LEFT JOIN "User" u ON u.id=l.created_by_id
      LEFT JOIN project_lesson_views v ON v.lesson_id=l.id AND v.user_id=${Number(user.id)}
      WHERE l.status='approved' OR (${canReview}::boolean AND l.status='pending')
      ORDER BY CASE WHEN l.status='pending' THEN 0 ELSE 1 END, l.created_at DESC
    `;
    return json({ items: rows.map(mapItem), canReview });
  } catch (error) {
    console.error("project_lessons_get_failed", error);
    return json({ error: "project_lessons_get_failed" }, 500);
  }
}

export async function POST(request) {
  try {
    const user = await currentUser(request);
    if (!user) return json({ error: "unauthorized" }, 401);
    const lesson = parseLesson(await request.json().catch(() => ({})));
    if (!validLesson(lesson))
      return json({ error: "required_fields_missing" }, 400);
    const project = await activeProject(lesson.projectId);
    if (!project) return json({ error: "active_project_required" }, 400);
    await ensureSchema();
    const id = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO project_lessons (id,project_id,category,challenge,solution,importance,impacts,tag_ids,files,created_by_id,status)
      VALUES (${id},${lesson.projectId},${lesson.category},${lesson.challenge},${lesson.solution},${lesson.importance},${JSON.stringify(lesson.impacts)}::jsonb,${JSON.stringify(lesson.tagIds)}::jsonb,${JSON.stringify(lesson.files)}::jsonb,${Number(user.id)},'pending')
    `;
    return json({ ok: true, pending: true }, 201);
  } catch (error) {
    console.error("project_lessons_post_failed", error);
    return json({ error: "project_lessons_post_failed" }, 500);
  }
}

export async function PATCH(request) {
  try {
    const user = await currentUser(request);
    if (!user) return json({ error: "unauthorized" }, 401);
    if (!(await isManagementAppointee(user.id)))
      return json({ error: "forbidden" }, 403);
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    const action = String(body.action || "save");
    if (!id) return json({ error: "id_required" }, 400);
    await ensureSchema();
    if (action === "reject") {
      const deleted =
        await prisma.$executeRaw`DELETE FROM project_lessons WHERE id=${id} AND status='pending'`;
      if (!Number(deleted)) return json({ error: "not_found" }, 404);
      return json({ ok: true, rejected: true });
    }
    const lesson = parseLesson(body);
    if (!validLesson(lesson))
      return json({ error: "required_fields_missing" }, 400);
    const project = await activeProject(lesson.projectId);
    if (!project) return json({ error: "active_project_required" }, 400);
    const rows =
      action === "approve"
        ? await prisma.$queryRaw`UPDATE project_lessons SET project_id=${lesson.projectId},category=${lesson.category},challenge=${lesson.challenge},solution=${lesson.solution},importance=${lesson.importance},impacts=${JSON.stringify(lesson.impacts)}::jsonb,tag_ids=${JSON.stringify(lesson.tagIds)}::jsonb,files=${JSON.stringify(lesson.files)}::jsonb,status='approved',reviewed_by_id=${Number(user.id)},reviewed_at=NOW() WHERE id=${id} AND status='pending' RETURNING *`
        : await prisma.$queryRaw`UPDATE project_lessons SET project_id=${lesson.projectId},category=${lesson.category},challenge=${lesson.challenge},solution=${lesson.solution},importance=${lesson.importance},impacts=${JSON.stringify(lesson.impacts)}::jsonb,tag_ids=${JSON.stringify(lesson.tagIds)}::jsonb,files=${JSON.stringify(lesson.files)}::jsonb WHERE id=${id} RETURNING *`;
    if (!rows.length) return json({ error: "not_found" }, 404);
    return json({ item: await enrichedRow(rows[0], project) });
  } catch (error) {
    console.error("project_lessons_patch_failed", error);
    return json({ error: "project_lessons_patch_failed" }, 500);
  }
}

export async function DELETE(request) {
  try {
    const user = await currentUser(request);
    if (!user) return json({ error: "unauthorized" }, 401);
    if (!(await isManagementAppointee(user.id)))
      return json({ error: "forbidden" }, 403);
    const ids = list((await request.json().catch(() => ({}))).ids);
    if (!ids.length) return json({ error: "ids_required" }, 400);
    await ensureSchema();
    const results = await prisma.$transaction(
      ids.map(
        (id) => prisma.$executeRaw`DELETE FROM project_lessons WHERE id=${id}`,
      ),
    );
    return json({
      ok: true,
      deleted: results.reduce((a, b) => a + Number(b || 0), 0),
    });
  } catch (error) {
    console.error("project_lessons_delete_failed", error);
    return json({ error: "project_lessons_delete_failed" }, 500);
  }
}
