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

function normalizeCode(value = "") {
  return String(value ?? "")
    .trim()
    .replace(/[^\d.-]/g, "-")
    .replace(/[.-]+/g, "-")
    .replace(/^-/, "")
    .replace(/-$/, "");
}

function nextChildCode(parentCode, codes = []) {
  const base = normalizeCode(parentCode);
  const prefix = base ? `${base}-` : "";
  let max = 0;

  codes.forEach((item) => {
    const code = normalizeCode(item?.code ?? item?.budget_code ?? item);
    if (!prefix || !code.startsWith(prefix)) return;
    const rest = code.slice(prefix.length);
    if (!/^\d+$/.test(rest)) return;
    const value = Number(rest);
    if (value > 9999) return;
    max = Math.max(max, value);
  });

  return `${base}-${max + 1}`;
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
    CREATE TABLE IF NOT EXISTS "revenue_forecast_items" (
      "id" SERIAL NOT NULL,
      "project_id" INTEGER NOT NULL,
      "parent_code" VARCHAR(80),
      "code" VARCHAR(80) NOT NULL,
      "title" VARCHAR(255) NOT NULL,
      "row_index" INTEGER NOT NULL DEFAULT 0,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "revenue_forecast_items_pkey" PRIMARY KEY ("id")
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
    CREATE UNIQUE INDEX IF NOT EXISTS "revenue_forecast_items_project_id_code_key"
    ON "revenue_forecast_items"("project_id", "code")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "revenue_forecast_items_project_id_idx"
    ON "revenue_forecast_items"("project_id")
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

  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'revenue_forecast_items_project_id_fkey'
      ) THEN
        ALTER TABLE "revenue_forecast_items"
        ADD CONSTRAINT "revenue_forecast_items_project_id_fkey"
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

    const items = await prisma.$queryRaw`
      SELECT id, project_id, parent_code, code, title, row_index, updated_at
      FROM revenue_forecast_items
      ORDER BY project_id ASC, row_index ASC, id ASC
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
      items: (items || []).map((row) => ({
        id: Number(row.id),
        project_id: Number(row.project_id),
        parent_code: String(row.parent_code ?? ""),
        code: String(row.code ?? ""),
        title: String(row.title ?? ""),
        row_index: Number(row.row_index ?? 0),
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

    if (body?.action === "add_item") {
      const title = cleanText(body.title, 255);
      const parentCode = cleanText(body.parent_code ?? body.parentCode ?? "", 80);
      if (!title) return json({ error: "title_required" }, 400);

      await prisma.$executeRaw`
        INSERT INTO revenue_forecast_projects (project_id, updated_at)
        VALUES (${projectId}, CURRENT_TIMESTAMP)
        ON CONFLICT (project_id)
        DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      `;

      const projectRows = await prisma.$queryRaw`
        SELECT code FROM projects WHERE id = ${projectId} LIMIT 1
      `;
      const projectCode = normalizeCode(projectRows?.[0]?.code ?? projectId);
      const baseCode = normalizeCode(parentCode || projectCode);
      const childLike = `${baseCode}-%`;
      const existingRows = await prisma.$queryRaw`
        SELECT code FROM revenue_forecast_items
        WHERE project_id = ${projectId} AND code LIKE ${childLike}
        UNION ALL
        SELECT budget_code AS code FROM cost_breakdown_items
        WHERE project_id = ${projectId} AND budget_code LIKE ${childLike}
      `;
      const code = cleanText(nextChildCode(baseCode, existingRows || []), 80);
      const orderRows = await prisma.$queryRaw`
        SELECT COALESCE(MAX(row_index), 0) AS max_index
        FROM revenue_forecast_items
        WHERE project_id = ${projectId}
      `;
      const rowIndex = Number(orderRows?.[0]?.max_index ?? 0) + 1;

      const rows = await prisma.$queryRaw`
        INSERT INTO revenue_forecast_items (project_id, parent_code, code, title, row_index, updated_at)
        VALUES (${projectId}, ${parentCode || null}, ${code}, ${title}, ${rowIndex}, CURRENT_TIMESTAMP)
        RETURNING id, project_id, parent_code, code, title, row_index, updated_at
      `;
      const item = Array.isArray(rows) ? rows[0] : null;
      return json({
        ok: true,
        item: item
          ? {
              id: Number(item.id),
              project_id: Number(item.project_id),
              parent_code: String(item.parent_code ?? ""),
              code: String(item.code ?? ""),
              title: String(item.title ?? ""),
              row_index: Number(item.row_index ?? 0),
            }
          : null,
      }, 201);
    }

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
    const itemId = toPositiveInt(body.item_id ?? body.itemId);

    if (!projectId) return json({ error: "project_id_required" }, 400);

    if (budgetCode) {
      await prisma.$executeRaw`
        DELETE FROM revenue_forecast_values
        WHERE project_id = ${projectId} AND budget_code = ${budgetCode}
      `;
      if (itemId) {
        await prisma.$executeRaw`
          DELETE FROM revenue_forecast_items
          WHERE project_id = ${projectId} AND id = ${itemId}
        `;
      }
    } else {
      await prisma.$executeRaw`
        DELETE FROM revenue_forecast_values
        WHERE project_id = ${projectId}
      `;
      await prisma.$executeRaw`
        DELETE FROM revenue_forecast_items
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
