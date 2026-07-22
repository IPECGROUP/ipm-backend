import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

function json(data, status = 200) {
  return Response.json(data, { status });
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const projectId = Number(body?.projectId);
    const createdById = Number(request.headers.get("x-user-id")) || null;
    if (!Number.isInteger(projectId) || projectId <= 0) return json({ error: "invalid_project" }, 400);
    const project = await prisma.project.findFirst({ where: { id: projectId, isActive: true }, select: { id: true } });
    if (!project) return json({ error: "active_project_not_found" }, 404);
    const exists = await prisma.liquidityAllocation.findFirst({ where: { projectId }, select: { id: true } });
    if (!exists) {
      await prisma.liquidityAllocation.create({
        data: {
          allocationDate: "",
          source: "__project_selection__",
          availableAmount: 0n,
          description: "",
          projectId,
          amount: 0n,
          createdById,
        },
      });
    }
    return json({ ok: true });
  } catch (error) {
    return json({ error: "internal_error", message: String(error?.message || "internal_error") }, 500);
  }
}
