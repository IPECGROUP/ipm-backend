import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";

let schemaPromise;

export function noStoreJson(data, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function getCurrentUser(request) {
  const cookie = request.headers.get("cookie") || "";
  const token = cookie.match(/(?:^|;\s*)ipm_session=([^;]+)/)?.[1];

  if (token) {
    const session = await prisma.session
      .findUnique({
        where: { id: decodeURIComponent(token) },
        include: { user: true },
      })
      .catch(() => null);

    const isValid =
      session?.user &&
      (!session.expiresAt || new Date(session.expiresAt) >= new Date());
    if (isValid) return session.user;
  }

  const developmentUserId = request.headers.get("x-user-id");
  if (
    process.env.NODE_ENV !== "production" &&
    /^\d+$/.test(developmentUserId || "")
  ) {
    return { id: Number(developmentUserId) };
  }

  return null;
}

function normalizeUnitName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\s+/g, " ");
}

export async function isManagementAppointee(userId) {
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: {
      isActive: true,
      units: {
        select: {
          unit: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!user || user.isActive === false) return false;

  const hasDirectManagementMembership = user.units.some(
    ({ unit }) => normalizeUnitName(unit?.name) === "مدیریت",
  );
  if (hasDirectManagementMembership) return true;

  const appointments = await prisma.$queryRaw`
    SELECT DISTINCT unit.id, unit.name
    FROM "UserRoleMap" user_role
    INNER JOIN "UnitRoleMap" unit_role
      ON unit_role."roleId" = user_role."roleId"
    INNER JOIN "Unit" unit
      ON unit.id = unit_role."unitId"
    WHERE user_role."userId" = ${Number(userId)}
  `.catch(() => []);

  // Match the organizational workflow used elsewhere in the application:
  // membership may be direct (UserUnit) or inherited from an assigned role
  // (UserRoleMap -> UnitRoleMap). Unit codes never grant management access.
  return appointments.some(({ name }) => normalizeUnitName(name) === "مدیریت");
}

export async function ensureProjectLessonsSchema() {
  if (!schemaPromise) {
    schemaPromise = createProjectLessonsSchema().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }

  return schemaPromise;
}

async function createProjectLessonsSchema() {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS project_lessons (
    id TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    challenge TEXT NOT NULL,
    solution TEXT NOT NULL,
    importance TEXT NOT NULL,
    impacts JSONB NOT NULL DEFAULT '[]'::jsonb,
    tag_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    files JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by_id INTEGER,
    view_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'approved',
    reviewed_by_id INTEGER,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await Promise.all([
    prisma.$executeRawUnsafe(
      "ALTER TABLE project_lessons ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0",
    ),
    prisma.$executeRawUnsafe(
      "ALTER TABLE project_lessons ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'",
    ),
    prisma.$executeRawUnsafe(
      "ALTER TABLE project_lessons ADD COLUMN IF NOT EXISTS reviewed_by_id INTEGER",
    ),
    prisma.$executeRawUnsafe(
      "ALTER TABLE project_lessons ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ",
    ),
  ]);

  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS project_lesson_views (
    lesson_id TEXT NOT NULL REFERENCES project_lessons(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,
    viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (lesson_id, user_id)
  )`);
}
