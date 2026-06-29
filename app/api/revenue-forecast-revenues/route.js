import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";

export const runtime = "nodejs";

const json = (data, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function cleanText(value, max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function toBigIntAmount(value) {
  const raw = String(value ?? "0")
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[^\d-]/g, "");

  if (!raw || raw === "-") return 0n;

  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

async function ensureRevenueForecastTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "revenue_forecast_projects" (
      "id" SERIAL NOT NULL,
      "project_id" INTEGER NOT NULL,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "revenue_forecast_projects_pkey" PRIMARY KEY ("id")
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "revenue_forecast_values" (
      "id" SERIAL NOT NULL,
      "project_id" INTEGER NOT NULL,
      "budget_code" VARCHAR(80) NOT NULL,
      "month_key" VARCHAR(12) NOT NULL,
      "amount" BIGINT NOT NULL DEFAULT 0,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "revenue_forecast_values_pkey" PRIMARY KEY ("id")
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "revenue_forecast_projects_project_id_key"
    ON "revenue_forecast_projects"("project_id")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "revenue_forecast_projects_project_id_idx"
    ON "revenue_forecast_projects"("project_id")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "revenue_forecast_values_project_id_budget_code_month_key_key"
    ON "revenue_forecast_values"("project_id", "budget_code", "month_key")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "revenue_forecast_values_project_id_idx"
    ON "revenue_forecast_values"("project_id")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "revenue_forecast_values_project_id_budget_code_idx"
    ON "revenue_forecast_values"("project_id", "budget_code")
  `);

  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'revenue_forecast_projects_project_id_fkey'
      ) THEN
        ALTER TABLE "revenue_forecast_projects"
        ADD CONSTRAINT "revenue_forecast_projects_project_id_fkey"
        FOREIGN KEY ("project_id") REFERENCES "projects"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$
  `);

  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'revenue_forecast_values_project_id_fkey'
      ) THEN
        ALTER TABLE "revenue_forecast_values"
        ADD CONSTRAINT "revenue_forecast_values_project_id_fkey"
        FOREIGN KEY ("project_id") REFERENCES "projects"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$
  `);
}

async function ensureActiveProject(projectId) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, isActive: true },
    select: { id: true },
  });
  return !!project;
}

export async function GET() {
  try {
    await ensureRevenueForecastTables();

    const projects = await prisma.$queryRaw`
      SELECT project_id, created_at, updated_at
      FROM revenue_forecast_projects
      ORDER BY id ASC
    `;

    const values = await prisma.$queryRaw`
      SELECT project_id, budget_code, month_key, amount, updated_at
      FROM revenue_forecast_values
      ORDER BY project_id ASC, budget_code ASC, month_key ASC
    `;

    return json({
      projects: (projects || []).map((row) => ({
        project_id: Number(row.project_id),
        created_at: row.created_at?.toISOString?.() ?? null,
        updated_at: row.updated_at?.toISOString?.() ?? null,
      })),
      values: (values || []).map((row) => ({
        project_id: Number(row.project_id),
        budget_code: String(row.budget_code ?? ""),
        month_key: String(row.month_key ?? ""),
        amount: String(row.amount ?? 0),
        updated_at: row.updated_at?.toISOString?.() ?? null,
      })),
    });
  } catch (e) {
    console.error("revenue_forecast_revenues_get_error", e);
    return json({ error: "internal_error" }, 500);
  }
}

export async function POST(req) {
  try {
    await ensureRevenueForecastTables();

    const body = await readJson(req);
    const projectId = toPositiveInt(body.project_id ?? body.projectId);
    if (!projectId) return json({ error: "project_id_required" }, 400);
    if (!(await ensureActiveProject(projectId))) return json({ error: "active_project_not_found" }, 404);

    await prisma.$executeRaw`
      INSERT INTO revenue_forecast_projects (project_id, updated_at)
      VALUES (${projectId}, CURRENT_TIMESTAMP)
      ON CONFLICT (project_id)
      DO UPDATE SET updated_at = CURRENT_TIMESTAMP
    `;

    return json({ ok: true, project_id: projectId }, 201);
  } catch (e) {
    console.error("revenue_forecast_revenues_post_error", e);
    return json({ error: "internal_error" }, 500);
  }
}

export async function PATCH(req) {
  try {
    await ensureRevenueForecastTables();

    const body = await readJson(req);
    const projectId = toPositiveInt(body.project_id ?? body.projectId);
    const budgetCode = cleanText(body.budget_code ?? body.budgetCode, 80);
    const monthKey = cleanText(body.month_key ?? body.monthKey, 12);
    const amount = toBigIntAmount(body.amount);

    if (!projectId) return json({ error: "project_id_required" }, 400);
    if (!budgetCode) return json({ error: "budget_code_required" }, 400);
    if (!/^m(1[0-2]|[1-9])$/.test(monthKey)) return json({ error: "invalid_month_key" }, 400);
    if (!(await ensureActiveProject(projectId))) return json({ error: "active_project_not_found" }, 404);

    await prisma.$executeRaw`
      INSERT INTO revenue_forecast_projects (project_id, updated_at)
      VALUES (${projectId}, CURRENT_TIMESTAMP)
      ON CONFLICT (project_id)
      DO UPDATE SET updated_at = CURRENT_TIMESTAMP
    `;

    await prisma.$executeRaw`
      INSERT INTO revenue_forecast_values (project_id, budget_code, month_key, amount, updated_at)
      VALUES (${projectId}, ${budgetCode}, ${monthKey}, ${amount}, CURRENT_TIMESTAMP)
      ON CONFLICT (project_id, budget_code, month_key)
      DO UPDATE SET amount = EXCLUDED.amount, updated_at = CURRENT_TIMESTAMP
    `;

    return json({ ok: true });
  } catch (e) {
    console.error("revenue_forecast_revenues_patch_error", e);
    return json({ error: "internal_error" }, 500);
  }
}

export async function DELETE(req) {
  try {
    await ensureRevenueForecastTables();

    const body = await readJson(req);
    const projectId = toPositiveInt(body.project_id ?? body.projectId);
    const budgetCode = cleanText(body.budget_code ?? body.budgetCode, 80);

    if (!projectId) return json({ error: "project_id_required" }, 400);

    if (budgetCode) {
      await prisma.$executeRaw`
        DELETE FROM revenue_forecast_values
        WHERE project_id = ${projectId} AND budget_code = ${budgetCode}
      `;
    } else {
      await prisma.$executeRaw`
        DELETE FROM revenue_forecast_values
        WHERE project_id = ${projectId}
      `;
      await prisma.$executeRaw`
        DELETE FROM revenue_forecast_projects
        WHERE project_id = ${projectId}
      `;
    }

    return json({ ok: true });
  } catch (e) {
    console.error("revenue_forecast_revenues_delete_error", e);
    return json({ error: "internal_error" }, 500);
  }
}
