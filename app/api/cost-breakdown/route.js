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

function serializeItem(item) {
  return {
    id: item.id,
    projectId: item.projectId,
    budgetCode: item.budgetCode,
    budgetName: item.budgetName,
    baseBudget: item.baseBudget.toString(),
    createdAt: item.createdAt?.toISOString?.() ?? null,
    updatedAt: item.updatedAt?.toISOString?.() ?? null,
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

const itemSelect = {
  id: true,
  projectId: true,
  budgetCode: true,
  budgetName: true,
  baseBudget: true,
  createdAt: true,
  updatedAt: true,
  project: {
    select: { id: true, code: true, name: true, isActive: true },
  },
};

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = toPositiveInt(searchParams.get("project_id"));

    const items = await prisma.costBreakdownItem.findMany({
      where: projectId ? { projectId } : undefined,
      select: itemSelect,
      orderBy: [{ projectId: "asc" }, { budgetCode: "asc" }, { id: "asc" }],
    });

    return json({ items: items.map(serializeItem) });
  } catch (e) {
    console.error("cost_breakdown_get_error", e);
    return json({ error: "internal_error" }, 500);
  }
}

export async function POST(req) {
  try {
    const body = await readJson(req);
    const projectId = toPositiveInt(body.project_id ?? body.projectId);
    const budgetCode = cleanText(body.budget_code ?? body.budgetCode, 80);
    const budgetName = cleanText(body.budget_name ?? body.budgetName, 255);
    const baseBudget = toBigIntAmount(body.base_budget ?? body.baseBudget);

    if (!projectId) return json({ error: "project_id_required" }, 400);
    if (!budgetCode || !budgetName) return json({ error: "budget_code_and_name_required" }, 400);
    if (!(await ensureActiveProject(projectId))) return json({ error: "active_project_not_found" }, 404);

    const item = await prisma.costBreakdownItem.create({
      data: { projectId, budgetCode, budgetName, baseBudget },
      select: itemSelect,
    });

    return json({ ok: true, item: serializeItem(item) }, 201);
  } catch (e) {
    console.error("cost_breakdown_post_error", e);
    if (e?.code === "P2002") return json({ error: "duplicate_budget_code" }, 409);
    return json({ error: "internal_error" }, 500);
  }
}

export async function PATCH(req) {
  try {
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

    const item = await prisma.costBreakdownItem.update({
      where: { id },
      data,
      select: itemSelect,
    });

    return json({ ok: true, item: serializeItem(item) });
  } catch (e) {
    console.error("cost_breakdown_patch_error", e);
    if (e?.code === "P2025") return json({ error: "not_found" }, 404);
    if (e?.code === "P2002") return json({ error: "duplicate_budget_code" }, 409);
    return json({ error: "internal_error" }, 500);
  }
}

export async function DELETE(req) {
  try {
    const url = new URL(req.url);
    let id = toPositiveInt(url.searchParams.get("id"));

    if (!id) {
      const body = await readJson(req);
      id = toPositiveInt(body.id);
    }

    if (!id) return json({ error: "invalid_id" }, 400);

    await prisma.costBreakdownItem.delete({ where: { id } });
    return json({ ok: true });
  } catch (e) {
    console.error("cost_breakdown_delete_error", e);
    if (e?.code === "P2025") return json({ error: "not_found" }, 404);
    return json({ error: "internal_error" }, 500);
  }
}
