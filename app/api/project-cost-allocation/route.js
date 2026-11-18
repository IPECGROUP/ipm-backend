import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requirePagePermission } from "../../../lib/pagePermissions";
import { getAuthenticatedUser } from "../../../lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let tablesReady;
async function createTables() {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS project_cost_allocations (
    project_id INTEGER NOT NULL REFERENCES projects(id), year INTEGER NOT NULL,
    month INTEGER NOT NULL, amount BIGINT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (project_id, year, month), CHECK (month BETWEEN 1 AND 12)
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS project_cost_allocation_history (
    id BIGSERIAL PRIMARY KEY, project_id INTEGER NOT NULL, year INTEGER NOT NULL,
    month INTEGER NOT NULL, old_amount BIGINT, new_amount BIGINT,
    actor_id INTEGER NOT NULL, actor_username TEXT, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

function ensureTables() {
  if (!tablesReady) tablesReady = createTables().catch((error) => { tablesReady = undefined; throw error; });
  return tablesReady;
}

const json = (value, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
const validYear = (value) => Number.isInteger(value) && value >= 1200 && value <= 1600;
const isMainProject = (project) => /^\d{3}$/.test(String(project.code ?? "").trim()
  .replace(/[۰-۹]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹".indexOf(digit))
  .replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
const isGeneral = (project) => String(project.name || "").trim().replace(/ي/g, "ی").replace(/ك/g, "ک") === "عمومی";

export async function GET(request) {
  const denied = await requirePagePermission(request, "کاربرگ مالی", "نمایش منو");
  if (denied) return denied;
  const year = Number(new URL(request.url).searchParams.get("year"));
  if (!validYear(year)) return json({ error: "invalid_year" }, 400);
  try {
    await ensureTables();
    const [projects, values] = await Promise.all([
      prisma.project.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
      prisma.$queryRaw`SELECT project_id, month, amount FROM project_cost_allocations WHERE year = ${year}`,
    ]);
    return json({ projects: projects.filter(isMainProject), values: values.map((row) => ({ projectId: row.project_id, month: row.month, amount: row.amount == null ? "" : String(row.amount) })) });
  } catch (error) {
    console.error("project_cost_allocation_get", error);
    return json({ error: "load_failed" }, 500);
  }
}

export async function PUT(request) {
  const denied = await requirePagePermission(request, "کاربرگ مالی", "نمایش منو");
  if (denied) return denied;
  try {
    const actor = await getAuthenticatedUser(request);
    if (!actor) return json({ error: "forbidden" }, 403);
    const body = await request.json();
    const projectId = Number(body.projectId), year = Number(body.year), month = Number(body.month);
    const amount = body.amount === "" ? null : String(body.amount);
    if (!Number.isInteger(projectId) || projectId <= 0 || !validYear(year) || !Number.isInteger(month) || month < 1 || month > 12 || (amount !== null && (!/^\d{1,18}$/.test(amount) || BigInt(amount) > 9223372036854775807n))) return json({ error: "invalid_value" }, 400);
    await ensureTables();
    await prisma.$transaction(async (tx) => {
      // Lock the entire year/month so concurrent users cannot exceed the limit.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${19367481}::int, ${year * 100 + month}::int)::text`;
      const project = await tx.project.findFirst({ where: { id: projectId, isActive: true }, select: { id: true, code: true, name: true } });
      if (!project || !isMainProject(project) || isGeneral(project)) throw new Error("inactive_project");
      const rows = await tx.$queryRaw`SELECT amount FROM project_cost_allocations WHERE project_id = ${projectId} AND year = ${year} AND month = ${month}`;
      const old = rows[0]?.amount == null ? null : String(rows[0].amount);
      const next = amount === null ? null : String(BigInt(amount));
      if (old === next) return;
      const activeProjects = (await tx.project.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true } })).filter((item) => isMainProject(item) && !isGeneral(item));
      const activeIds = new Set(activeProjects.map((item) => item.id));
      const existing = await tx.$queryRaw`SELECT project_id, amount FROM project_cost_allocations WHERE year = ${year} AND month = ${month}`;
      const total = existing.reduce((sum, row) => activeIds.has(row.project_id) && row.project_id !== projectId ? sum + (row.amount ?? 0n) : sum, 0n) + BigInt(next ?? "0");
      if (total > 100n) throw new Error("percentage_limit");
      await tx.$executeRaw`INSERT INTO project_cost_allocations (project_id, year, month, amount) VALUES (${projectId}, ${year}, ${month}, ${next}::bigint)
        ON CONFLICT (project_id, year, month) DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()`;
      await tx.$executeRaw`INSERT INTO project_cost_allocation_history (project_id, year, month, old_amount, new_amount, actor_id, actor_username)
        VALUES (${projectId}, ${year}, ${month}, ${old}::bigint, ${next}::bigint, ${Number(actor.id)}, ${actor.username || null})`;
    });
    return json({ ok: true });
  } catch (error) {
    if (error.message === "percentage_limit") return json({ error: "percentage_limit" }, 409);
    if (error.message === "inactive_project") return json({ error: "inactive_project" }, 400);
    console.error("project_cost_allocation_put", error);
    return json({ error: "save_failed" }, 500);
  }
}
