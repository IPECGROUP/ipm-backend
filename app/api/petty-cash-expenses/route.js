import { prisma } from "../../../lib/prisma";

export const runtime = "nodejs";

const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const cookie = (request, name) => String(request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] || "";

async function userIdOf(request) {
  const raw = request.headers.get("x-user-id") || cookie(request, "user_id");
  if (/^\d+$/.test(raw)) return Number(raw);
  const sessionId = cookie(request, "ipm_session");
  const session = sessionId && await prisma.session.findUnique({ where: { id: sessionId } }).catch(() => null);
  return session?.userId || (process.env.NODE_ENV !== "production" ? 1 : null);
}

function normalized(value = "") {
  return String(value).toLowerCase().replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/\s+/g, " ").trim();
}

function asAmount(value) {
  const digits = String(value ?? "")
    .replace(/[۰-۹]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹".indexOf(digit))
    .replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit))
    .replace(/[^\d]/g, "");
  return digits ? BigInt(digits) : 0n;
}

function belongsToWorkflowUnit(stage, unit) {
  const name = normalized(unit?.name);
  const code = normalized(unit?.code);
  const values = `${name} ${code}`;
  if (stage === "planning") return values.includes("برنامه ریزی") || values.includes("برنامه‌ریزی") || values.includes("planning");
  return values.includes("مدیریت پروژه") || values.includes("project management");
}

let ready;
async function ensureTable() {
  if (!ready) ready = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS petty_cash_expenses (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        expense_date VARCHAR(20) NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        budget_code VARCHAR(80) NOT NULL,
        amount BIGINT NOT NULL,
        created_by_id INTEGER NOT NULL,
        stage VARCHAR(32) NOT NULL DEFAULT 'planning',
        planning_status VARCHAR(20) NOT NULL DEFAULT 'pending',
        planning_by_id INTEGER,
        planning_at TIMESTAMP(3),
        project_manager_id INTEGER,
        project_manager_status VARCHAR(20) NOT NULL DEFAULT 'pending',
        project_manager_by_id INTEGER,
        project_manager_at TIMESTAMP(3),
        rejected_by_id INTEGER,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS petty_cash_expenses_project_idx ON petty_cash_expenses(project_id)");
    await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS petty_cash_expenses_assignee_idx ON petty_cash_expenses(project_manager_id, stage)");
    await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS petty_cash_expenses_creator_idx ON petty_cash_expenses(created_by_id)");
  })();
  return ready;
}

async function workflowMembers(stage) {
  const mappedRows = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT urm."userId" AS "userId", unit.name AS "unitName", unit.code AS "unitCode"
    FROM "UserRoleMap" urm
    INNER JOIN "UnitRoleMap" unit_role ON unit_role."roleId" = urm."roleId"
    INNER JOIN "Unit" unit ON unit.id = unit_role."unitId"
  `).catch(() => []);
  const mappedIds = new Set(mappedRows
    .filter((row) => belongsToWorkflowUnit(stage, { name: row.unitName, code: row.unitCode }))
    .map((row) => Number(row.userId)));
  const users = await prisma.user.findMany({
    where: { isActive: true },
    include: { units: { include: { unit: true } } },
    orderBy: { id: "asc" },
  });
  return users
    .filter((user) => mappedIds.has(user.id) || user.units.some((link) => belongsToWorkflowUnit(stage, link.unit)))
    .map((user) => ({ id: user.id, name: user.name, username: user.username, email: user.email }));
}

async function isMember(userId, stage) {
  return (await workflowMembers(stage)).some((user) => Number(user.id) === Number(userId));
}

function itemFromRow(row) {
  return {
    id: Number(row.id), projectId: Number(row.projectId), projectCode: row.projectCode, projectName: row.projectName,
    expenseDate: row.expenseDate, description: row.description, budgetCode: row.budgetCode, amount: String(row.amount),
    stage: row.stage, planningStatus: row.planningStatus, planningById: row.planningById,
    planningByName: row.planningByName, planningByUsername: row.planningByUsername, planningAt: row.planningAt,
    projectManagerId: row.projectManagerId, projectManagerStatus: row.projectManagerStatus,
    projectManagerById: row.projectManagerById, projectManagerByName: row.projectManagerByName,
    projectManagerByUsername: row.projectManagerByUsername, projectManagerAt: row.projectManagerAt,
    createdById: row.createdById, createdByName: row.createdByName,
  };
}

export async function GET(request) {
  try {
    await ensureTable();
    const userId = await userIdOf(request);
    if (!userId) return json({ error: "unauthorized" }, 401);
    const url = new URL(request.url);
    const recipients = url.searchParams.get("recipients");
    if (recipients === "project_manager") return json({ users: await workflowMembers("project_manager") });

    const projectId = Number(url.searchParams.get("projectId")) || 0;
    const [isPlanning, isProjectManager] = await Promise.all([isMember(userId, "planning"), isMember(userId, "project_manager")]);
    const rows = await prisma.$queryRawUnsafe(`
      SELECT e.id,e.project_id AS "projectId",p.code AS "projectCode",p.name AS "projectName",e.expense_date AS "expenseDate",e.description,e.budget_code AS "budgetCode",e.amount::text AS amount,
        e.stage,e.planning_status AS "planningStatus",e.planning_by_id AS "planningById",planner.name AS "planningByName",planner.username AS "planningByUsername",e.planning_at AS "planningAt",
        e.project_manager_id AS "projectManagerId",e.project_manager_status AS "projectManagerStatus",e.project_manager_by_id AS "projectManagerById",manager.name AS "projectManagerByName",manager.username AS "projectManagerByUsername",e.project_manager_at AS "projectManagerAt",
        e.created_by_id AS "createdById",creator.name AS "createdByName"
      FROM petty_cash_expenses e
      INNER JOIN projects p ON p.id=e.project_id
      LEFT JOIN "User" creator ON creator.id=e.created_by_id
      LEFT JOIN "User" planner ON planner.id=e.planning_by_id
      LEFT JOIN "User" manager ON manager.id=e.project_manager_by_id
      WHERE ($1::int=0 OR e.project_id=$1)
        AND (e.created_by_id=$2 OR e.project_manager_id=$2 OR $3::boolean)
      ORDER BY e.created_at DESC, e.id DESC
    `, projectId, userId, isPlanning);
    return json({ items: rows.map(itemFromRow), viewer: { userId, isPlanning, isProjectManager } });
  } catch (error) {
    console.error("petty_cash_expenses_get_error", error);
    return json({ error: "internal_error" }, 500);
  }
}

export async function POST(request) {
  try {
    await ensureTable();
    const userId = await userIdOf(request);
    if (!userId) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const projectId = Number(body.projectId);
    const expenseDate = String(body.expenseDate || "").trim();
    const description = String(body.description || "").trim();
    const budgetCode = String(body.budgetCode || "").trim();
    const amount = asAmount(body.amount);
    if (!projectId || !expenseDate || !description || !budgetCode || amount <= 0n) return json({ error: "invalid_input" }, 400);
    const [project, budget] = await Promise.all([
      prisma.project.findFirst({ where: { id: projectId, isActive: true }, select: { id: true } }),
      prisma.costBreakdownItem.findFirst({ where: { projectId, budgetCode }, select: { id: true } }),
    ]);
    if (!project) return json({ error: "active_project_not_found" }, 404);
    if (!budget) return json({ error: "budget_code_not_found" }, 400);
    const rows = await prisma.$queryRawUnsafe(`
      INSERT INTO petty_cash_expenses (project_id,expense_date,description,budget_code,amount,created_by_id)
      VALUES ($1,$2,$3,$4,$5::bigint,$6)
      RETURNING id
    `, projectId, expenseDate, description, budgetCode, String(amount), userId);
    return json({ ok: true, id: Number(rows[0].id) }, 201);
  } catch (error) {
    console.error("petty_cash_expenses_post_error", error);
    return json({ error: "internal_error" }, 500);
  }
}

export async function PATCH(request) {
  try {
    await ensureTable();
    const userId = await userIdOf(request);
    if (!userId) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const id = Number(body.id);
    const decision = body.decision;
    if (!id || !["approve", "reject"].includes(decision)) return json({ error: "invalid_input" }, 400);
    const expenseRows = await prisma.$queryRawUnsafe("SELECT * FROM petty_cash_expenses WHERE id=$1", id);
    const expense = expenseRows[0];
    if (!expense) return json({ error: "not_found" }, 404);

    if (expense.stage === "planning") {
      if (!(await isMember(userId, "planning"))) return json({ error: "not_allowed" }, 403);
      if (decision === "reject") {
        await prisma.$executeRawUnsafe("UPDATE petty_cash_expenses SET stage='rejected',planning_status='rejected',planning_by_id=$1,planning_at=CURRENT_TIMESTAMP,rejected_by_id=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2", userId, id);
      } else {
        const managerId = Number(body.projectManagerId);
        const managers = await workflowMembers("project_manager");
        if (!managerId || !managers.some((user) => user.id === managerId)) return json({ error: "invalid_project_manager" }, 400);
        await prisma.$executeRawUnsafe("UPDATE petty_cash_expenses SET stage='project_manager',planning_status='approved',planning_by_id=$1,planning_at=CURRENT_TIMESTAMP,project_manager_id=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3", userId, managerId, id);
      }
      return json({ ok: true });
    }

    if (expense.stage === "project_manager") {
      if (Number(expense.project_manager_id) !== userId) return json({ error: "not_allowed" }, 403);
      const nextStage = decision === "approve" ? "completed" : "rejected";
      const managerStatus = decision === "approve" ? "approved" : "rejected";
      await prisma.$executeRawUnsafe("UPDATE petty_cash_expenses SET stage=$1,project_manager_status=$2,project_manager_by_id=$3,project_manager_at=CURRENT_TIMESTAMP,rejected_by_id=CASE WHEN $2='rejected' THEN $3 ELSE rejected_by_id END,updated_at=CURRENT_TIMESTAMP WHERE id=$4", nextStage, managerStatus, userId, id);
      return json({ ok: true });
    }
    return json({ error: "already_processed" }, 400);
  } catch (error) {
    console.error("petty_cash_expenses_patch_error", error);
    return json({ error: "internal_error" }, 500);
  }
}
