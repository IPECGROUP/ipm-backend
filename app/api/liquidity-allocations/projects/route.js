import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

function json(data, status = 200) {
  return Response.json(data, { status });
}

async function ensureLiquidityTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS liquidity_allocations (
      id SERIAL PRIMARY KEY,
      allocation_date VARCHAR(20) NOT NULL,
      source VARCHAR(255) NOT NULL,
      available_amount BIGINT NOT NULL,
      description TEXT DEFAULT '',
      project_id INTEGER,
      amount BIGINT NOT NULL,
      created_by INTEGER,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export async function POST(request) {
  try {
    await ensureLiquidityTable();
    const body = await request.json().catch(() => ({}));
    const projectId = Number(body?.projectId);
    const createdById = Number(request.headers.get("x-user-id")) || null;
    if (!Number.isInteger(projectId) || projectId <= 0) return json({ error: "invalid_project" }, 400);
    const project = await prisma.project.findFirst({ where: { id: projectId, isActive: true }, select: { id: true } });
    if (!project) return json({ error: "active_project_not_found" }, 404);
    const exists = await prisma.$queryRawUnsafe("SELECT id FROM liquidity_allocations WHERE project_id = $1 LIMIT 1", projectId);
    if (!exists.length) {
      await prisma.$executeRawUnsafe(
        "INSERT INTO liquidity_allocations (allocation_date, source, available_amount, description, project_id, amount, created_by) VALUES ($1, $2, 0, $3, $4, 0, $5)",
        "",
        "__project_selection__",
        "",
        projectId,
        createdById,
      );
    }
    return json({ ok: true });
  } catch (error) {
    return json({ error: "internal_error", message: String(error?.message || "internal_error") }, 500);
  }
}
