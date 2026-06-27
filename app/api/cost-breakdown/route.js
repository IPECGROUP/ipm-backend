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

function cleanText(value, max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function toBigIntAmount(value) {
  const raw = String(value ?? "0")
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[^\d-]/g, "");

  if (!raw || raw === "-") return 0n;

  try {
    const amount = BigInt(raw);
    return amount < 0n ? 0n : amount;
  } catch {
    return 0n;
  }
}

async function ensureCostBreakdownTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "cost_breakdown_items" (
      "id" SERIAL NOT NULL,
      "project_id" INTEGER NOT NULL,
      "budget_code" VARCHAR(80) NOT NULL,
      "budget_name" VARCHAR(255) NOT NULL,
      "base_budget" BIGINT NOT NULL DEFAULT 0,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "cost_breakdown_items_pkey" PRIMARY KEY ("id")
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "cost_breakdown_items_project_id_idx"
    ON "cost_breakdown_items"("project_id")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "cost_breakdown_items_project_id_budget_code_key"
    ON "cost_breakdown_items"("project_id", "budget_code")
  `);

  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'cost_breakdown_items_project_id_fkey'
      ) THEN
        ALTER TABLE "cost_breakdown_items"
        ADD CONSTRAINT "cost_breakdown_items_project_id_fkey"
        FOREIGN KEY ("project_id") REFERENCES "projects"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$
  `);
}

function serializeItem(item) {
  return {
    id: Number(item.id),
    projectId: Number(item.projectId ?? item.project_id),
    budgetCode: String(item.budgetCode ?? item.budget_code ?? ""),
    budgetName: String(item.budgetName ?? item.budget_name ?? ""),
    baseBudget: String(item.baseBudget ?? item.base_budget ?? 0),
    createdAt: item.createdAt?.toISOString?.() ?? item.created_at?.toISOString?.() ?? null,
    updatedAt: item.updatedAt?.toISOString?.() ?? item.updated_at?.toISOString?.() ?? null,
    project: item.project
      ? {
          id: item.project.id,
          code: item.project.code,
          name: item.project.name,
          isActive: item.project.isActive,
        }
      : null,
  };
}

async function ensureActiveProject(projectId) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, isActive: true },
    select: { id: true },
  });

  return !!project;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = toPositiveInt(searchParams.get("project_id"));

    const queryItems = () =>
      projectId
        ? prisma.$queryRaw`
            SELECT
              id,
              project_id,
              budget_code,
              budget_name,
              base_budget,
              created_at,
              updated_at
            FROM cost_breakdown_items
            WHERE project_id = ${projectId}
            ORDER BY budget_code ASC, id ASC
          `
        : prisma.$queryRaw`
            SELECT
              id,
              project_id,
              budget_code,
              budget_name,
              base_budget,
              created_at,
              updated_at
            FROM cost_breakdown_items
            ORDER BY project_id ASC, budget_code ASC, id ASC
          `;

    let items = [];
    try {
      items = await queryItems();
    } catch (e) {
      const tableMissing =
        e?.code === "P2021" ||
        e?.code === "P2022" ||
        /cost_breakdown_items|does not exist|table.*not.*exist/i.test(String(e?.message || ""));

      if (!tableMissing) throw e;

      try {
        await ensureCostBreakdownTable();
        items = await queryItems();
      } catch (setupError) {
        console.error("cost_breakdown_table_setup_error", setupError);
        return json({ items: [], setupRequired: true });
      }
    }

    return json({ items: items.map(serializeItem) });
  } catch (e) {
    console.error("cost_breakdown_get_error", e);
    return json({ error: "internal_error" }, 500);
  }
}

export async function POST(req) {
  try {
    await ensureCostBreakdownTable();

    const body = await readJson(req);
    const projectId = toPositiveInt(body.project_id ?? body.projectId);
    const budgetCode = cleanText(body.budget_code ?? body.budgetCode, 80);
    const budgetName = cleanText(body.budget_name ?? body.budgetName, 255);
    const baseBudget = toBigIntAmount(body.base_budget ?? body.baseBudget);

    if (!projectId) return json({ error: "project_id_required" }, 400);
    if (!budgetCode || !budgetName) return json({ error: "budget_code_and_name_required" }, 400);
    if (!(await ensureActiveProject(projectId))) return json({ error: "active_project_not_found" }, 404);

    const rows = await prisma.$queryRaw`
      INSERT INTO cost_breakdown_items (project_id, budget_code, budget_name, base_budget)
      VALUES (${projectId}, ${budgetCode}, ${budgetName}, ${baseBudget})
      RETURNING id, project_id, budget_code, budget_name, base_budget, created_at, updated_at
    `;
    const item = Array.isArray(rows) ? rows[0] : null;

    return json({ ok: true, item: serializeItem(item) }, 201);
  } catch (e) {
    console.error("cost_breakdown_post_error", e);
    if (e?.code === "P2002" || e?.code === "P2010" || /unique|duplicate/i.test(String(e?.message || ""))) {
      return json({ error: "duplicate_budget_code" }, 409);
    }
    return json({ error: "internal_error" }, 500);
  }
}

export async function PATCH(req) {
  try {
    await ensureCostBreakdownTable();

    const body = await readJson(req);
    const id = toPositiveInt(body.id);
    if (!id) return json({ error: "invalid_id" }, 400);

    const data = {};
    const projectId = body.project_id !== undefined || body.projectId !== undefined
      ? toPositiveInt(body.project_id ?? body.projectId)
      : null;

    if (body.project_id !== undefined || body.projectId !== undefined) {
      if (!projectId) return json({ error: "project_id_required" }, 400);
      if (!(await ensureActiveProject(projectId))) return json({ error: "active_project_not_found" }, 404);
      data.projectId = projectId;
    }

    if (body.budget_code !== undefined || body.budgetCode !== undefined) {
      const budgetCode = cleanText(body.budget_code ?? body.budgetCode, 80);
      if (!budgetCode) return json({ error: "budget_code_required" }, 400);
      data.budgetCode = budgetCode;
    }

    if (body.budget_name !== undefined || body.budgetName !== undefined) {
      const budgetName = cleanText(body.budget_name ?? body.budgetName, 255);
      if (!budgetName) return json({ error: "budget_name_required" }, 400);
      data.budgetName = budgetName;
    }

    if (body.base_budget !== undefined || body.baseBudget !== undefined) {
      data.baseBudget = toBigIntAmount(body.base_budget ?? body.baseBudget);
    }

    if (!Object.keys(data).length) return json({ error: "empty_payload" }, 400);

    const currentRows = await prisma.$queryRaw`
      SELECT id, project_id, budget_code, budget_name, base_budget
      FROM cost_breakdown_items
      WHERE id = ${id}
      LIMIT 1
    `;
    const current = Array.isArray(currentRows) ? currentRows[0] : null;
    if (!current) return json({ error: "not_found" }, 404);

    const nextProjectId = data.projectId ?? Number(current.project_id);
    const nextBudgetCode = data.budgetCode ?? String(current.budget_code);
    const nextBudgetName = data.budgetName ?? String(current.budget_name);
    const nextBaseBudget = data.baseBudget ?? BigInt(String(current.base_budget ?? 0));

    const rows = await prisma.$queryRaw`
      UPDATE cost_breakdown_items
      SET
        project_id = ${nextProjectId},
        budget_code = ${nextBudgetCode},
        budget_name = ${nextBudgetName},
        base_budget = ${nextBaseBudget},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
      RETURNING id, project_id, budget_code, budget_name, base_budget, created_at, updated_at
    `;
    const item = Array.isArray(rows) ? rows[0] : null;

    return json({ ok: true, item: serializeItem(item) });
  } catch (e) {
    console.error("cost_breakdown_patch_error", e);
    if (e?.code === "P2025") return json({ error: "not_found" }, 404);
    if (e?.code === "P2002" || e?.code === "P2010" || /unique|duplicate/i.test(String(e?.message || ""))) {
      return json({ error: "duplicate_budget_code" }, 409);
    }
    return json({ error: "internal_error" }, 500);
  }
}

export async function DELETE(req) {
  try {
    await ensureCostBreakdownTable();

    const url = new URL(req.url);
    let id = toPositiveInt(url.searchParams.get("id"));

    if (!id) {
      const body = await readJson(req);
      id = toPositiveInt(body.id);
    }

    if (!id) return json({ error: "invalid_id" }, 400);

    const result = await prisma.$executeRaw`
      DELETE FROM cost_breakdown_items
      WHERE id = ${id}
    `;
    if (!result) return json({ error: "not_found" }, 404);

    return json({ ok: true });
  } catch (e) {
    console.error("cost_breakdown_delete_error", e);
    if (e?.code === "P2025") return json({ error: "not_found" }, 404);
    return json({ error: "internal_error" }, 500);
  }
}
