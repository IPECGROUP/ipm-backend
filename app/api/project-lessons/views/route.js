import { prisma } from "../../../../lib/prisma";
import {
  ensureProjectLessonsSchema,
  getCurrentUser,
  isManagementAppointee,
  noStoreJson,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function markPendingLessonAsRead(lessonId, userId) {
  await prisma.$executeRaw`
    INSERT INTO project_lesson_views (lesson_id, user_id)
    VALUES (${lessonId}, ${userId})
    ON CONFLICT (lesson_id, user_id)
    DO UPDATE SET viewed_at = NOW()
  `;
}

async function incrementApprovedLessonViews(lessonId) {
  const [updatedLesson] = await prisma.$queryRaw`
    UPDATE project_lessons
    SET view_count = view_count + 1
    WHERE id = ${lessonId}
    RETURNING view_count
  `;

  return Number(updatedLesson.view_count);
}

export async function POST(request) {
  try {
    const user = await getCurrentUser(request);
    if (!user) return noStoreJson({ error: "unauthorized" }, 401);

    const body = await request.json().catch(() => ({}));
    const lessonId = String(body.id || "").trim();
    if (!lessonId) return noStoreJson({ error: "id_required" }, 400);

    await ensureProjectLessonsSchema();
    const [lesson] = await prisma.$queryRaw`
      SELECT status, view_count
      FROM project_lessons
      WHERE id = ${lessonId}
    `;
    if (!lesson) return noStoreJson({ error: "not_found" }, 404);

    if (lesson.status === "pending") {
      const canReview = await isManagementAppointee(user.id);
      if (!canReview) return noStoreJson({ error: "forbidden" }, 403);

      await markPendingLessonAsRead(lessonId, Number(user.id));
      return noStoreJson({
        viewCount: Number(lesson.view_count || 0),
        isUnread: false,
      });
    }

    const viewCount = await incrementApprovedLessonViews(lessonId);
    return noStoreJson({ viewCount, isUnread: false });
  } catch (error) {
    console.error("project_lesson_view_failed", error);
    return noStoreJson({ error: "view_update_failed" }, 500);
  }
}
