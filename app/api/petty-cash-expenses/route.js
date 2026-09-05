import { prisma } from "../../../lib/prisma";

export const runtime = "nodejs";

const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const cookie = (request, name) => String(request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] || "";

class RouteError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

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
    // CREATE TABLE IF NOT EXISTS does not add columns to installations that
    // already have an older version of this runtime-managed table.
    await prisma.$executeRawUnsafe("ALTER TABLE petty_cash_expenses ADD COLUMN IF NOT EXISTS rejected_by_id INTEGER");
    await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS petty_cash_expenses_project_idx ON petty_cash_expenses(project_id)");
    await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS petty_cash_expenses_assignee_idx ON petty_cash_expenses(project_manager_id, stage)");
    await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS petty_cash_expenses_creator_idx ON petty_cash_expenses(created_by_id)");
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS petty_cash_settlement_reports (
        id SERIAL PRIMARY KEY,
        report_number VARCHAR(40) NOT NULL UNIQUE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
        created_by_id INTEGER NOT NULL,
        prepared_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS petty_cash_settlement_report_items (
        id SERIAL PRIMARY KEY,
        report_id INTEGER NOT NULL REFERENCES petty_cash_settlement_reports(id) ON DELETE CASCADE,
        expense_id INTEGER NOT NULL UNIQUE REFERENCES petty_cash_expenses(id) ON DELETE RESTRICT,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(report_id, expense_id)
      )
    `);
    await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS petty_cash_settlement_reports_project_idx ON petty_cash_settlement_reports(project_id)");
    await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS petty_cash_settlement_report_items_report_idx ON petty_cash_settlement_report_items(report_id)");
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
    settlementReportId: row.settlementReportId ? Number(row.settlementReportId) : null,
    settlementReportNumber: row.settlementReportNumber || null,
  };
}

function reportFromRow(row) {
  return {
    id: Number(row.id), reportNumber: row.reportNumber, projectId: Number(row.projectId),
    projectCode: row.projectCode, projectName: row.projectName, preparedAt: row.preparedAt,
    itemCount: Number(row.itemCount || 0), createdById: Number(row.createdById),
    createdByName: row.createdByName, createdByUsername: row.createdByUsername,
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

    if (url.searchParams.get("summary") === "mine") {
      const rows = await prisma.$queryRawUnsafe(`
        WITH received AS (
          SELECT t.project_id AS "projectId",
            COALESCE(SUM(COALESCE(t.charged_amount, 0)), 0) AS "receivedAmount"
          FROM tenkhah_requests t
          WHERE COALESCE(t.beneficiary_user_id, t.created_by_id) = $1
            AND t.status = 'charged'
          GROUP BY t.project_id
        ), expenses AS (
          SELECT e.project_id AS "projectId",
            COALESCE(SUM(e.amount), 0) AS "registeredExpenses",
            COALESCE(SUM(e.amount) FILTER (
              WHERE e.stage = 'completed'
                AND e.project_manager_status = 'approved'
            ), 0) AS "approvedExpenses"
          FROM petty_cash_expenses e
          WHERE e.created_by_id = $1
          GROUP BY e.project_id
        ), totals AS (
          SELECT COALESCE(received."projectId", expenses."projectId") AS "projectId",
            COALESCE(received."receivedAmount", 0) AS "receivedAmount",
            COALESCE(expenses."registeredExpenses", 0) AS "registeredExpenses",
            COALESCE(expenses."approvedExpenses", 0) AS "approvedExpenses"
          FROM received
          FULL OUTER JOIN expenses ON expenses."projectId" = received."projectId"
        )
        SELECT totals."projectId", p.code AS "projectCode", p.name AS "projectName",
          totals."receivedAmount"::text AS "receivedAmount",
          totals."registeredExpenses"::text AS "registeredExpenses",
          (totals."receivedAmount" - totals."registeredExpenses")::text AS "registeredBalance",
          totals."approvedExpenses"::text AS "approvedExpenses",
          (totals."registeredExpenses" - totals."approvedExpenses")::text AS "unapprovedBalance"
        FROM totals
        INNER JOIN projects p ON p.id = totals."projectId"
        ORDER BY p.code ASC, p.name ASC
      `, userId);
      return json({ items: rows.map((row) => ({ ...row, projectId: Number(row.projectId) })) });
    }

    const [isPlanning, isProjectManager] = await Promise.all([isMember(userId, "planning"), isMember(userId, "project_manager")]);
    if (url.searchParams.get("reports") === "1") {
      const reportId = Number(url.searchParams.get("reportId")) || 0;
      const reportRows = await prisma.$queryRawUnsafe(`
        SELECT r.id,r.report_number AS "reportNumber",r.project_id AS "projectId",p.code AS "projectCode",p.name AS "projectName",r.prepared_at AS "preparedAt",
          r.created_by_id AS "createdById",creator.name AS "createdByName",creator.username AS "createdByUsername",COUNT(ri.id)::int AS "itemCount"
        FROM petty_cash_settlement_reports r
        INNER JOIN projects p ON p.id=r.project_id
        LEFT JOIN "User" creator ON creator.id=r.created_by_id
        LEFT JOIN petty_cash_settlement_report_items ri ON ri.report_id=r.id
        WHERE ($3::int=0 OR r.id=$3)
          AND (r.created_by_id=$1 OR $2::boolean OR EXISTS (
            SELECT 1 FROM petty_cash_settlement_report_items visible_ri
            INNER JOIN petty_cash_expenses visible_e ON visible_e.id=visible_ri.expense_id
            WHERE visible_ri.report_id=r.id AND visible_e.project_manager_id=$1
          ))
        GROUP BY r.id,p.code,p.name,creator.name,creator.username
        ORDER BY r.prepared_at DESC,r.id DESC
      `, userId, isPlanning, reportId);
      if (reportId && !reportRows.length) return json({ error: "report_not_found" }, 404);
      if (!reportId) return json({ items: reportRows.map(reportFromRow) });
      const expenseRows = await prisma.$queryRawUnsafe(`
        SELECT e.id,e.project_id AS "projectId",p.code AS "projectCode",p.name AS "projectName",e.expense_date AS "expenseDate",e.description,e.budget_code AS "budgetCode",e.amount::text AS amount,
          e.stage,e.planning_status AS "planningStatus",e.planning_by_id AS "planningById",planner.name AS "planningByName",planner.username AS "planningByUsername",e.planning_at AS "planningAt",
          e.project_manager_id AS "projectManagerId",e.project_manager_status AS "projectManagerStatus",e.project_manager_by_id AS "projectManagerById",manager.name AS "projectManagerByName",manager.username AS "projectManagerByUsername",e.project_manager_at AS "projectManagerAt",
          e.created_by_id AS "createdById",expense_creator.name AS "createdByName",r.id AS "settlementReportId",r.report_number AS "settlementReportNumber"
        FROM petty_cash_settlement_report_items ri
        INNER JOIN petty_cash_settlement_reports r ON r.id=ri.report_id
        INNER JOIN petty_cash_expenses e ON e.id=ri.expense_id
        INNER JOIN projects p ON p.id=e.project_id
        LEFT JOIN "User" expense_creator ON expense_creator.id=e.created_by_id
        LEFT JOIN "User" planner ON planner.id=e.planning_by_id
        LEFT JOIN "User" manager ON manager.id=e.project_manager_by_id
        WHERE ri.report_id=$1
        ORDER BY ri.id ASC
      `, reportId);
      return json({ report: reportFromRow(reportRows[0]), items: expenseRows.map(itemFromRow) });
    }

    const projectId = Number(url.searchParams.get("projectId")) || 0;
    const rows = await prisma.$queryRawUnsafe(`
      SELECT e.id,e.project_id AS "projectId",p.code AS "projectCode",p.name AS "projectName",e.expense_date AS "expenseDate",e.description,e.budget_code AS "budgetCode",e.amount::text AS amount,
        e.stage,e.planning_status AS "planningStatus",e.planning_by_id AS "planningById",planner.name AS "planningByName",planner.username AS "planningByUsername",e.planning_at AS "planningAt",
        e.project_manager_id AS "projectManagerId",e.project_manager_status AS "projectManagerStatus",e.project_manager_by_id AS "projectManagerById",manager.name AS "projectManagerByName",manager.username AS "projectManagerByUsername",e.project_manager_at AS "projectManagerAt",
        e.created_by_id AS "createdById",creator.name AS "createdByName",report.id AS "settlementReportId",report.report_number AS "settlementReportNumber"
      FROM petty_cash_expenses e
      INNER JOIN projects p ON p.id=e.project_id
      LEFT JOIN "User" creator ON creator.id=e.created_by_id
      LEFT JOIN "User" planner ON planner.id=e.planning_by_id
      LEFT JOIN "User" manager ON manager.id=e.project_manager_by_id
      LEFT JOIN petty_cash_settlement_report_items report_item ON report_item.expense_id=e.id
      LEFT JOIN petty_cash_settlement_reports report ON report.id=report_item.report_id
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
    if (body.action === "create_settlement_report") {
      const expenseIds = [...new Set((Array.isArray(body.expenseIds) ? body.expenseIds : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
      if (expenseIds.length < 2) return json({ error: "at_least_two_expenses_required" }, 400);
      const isPlanning = await isMember(userId, "planning");
      const report = await prisma.$transaction(async (tx) => {
        const expenses = await tx.$queryRawUnsafe(`
          SELECT id,project_id AS "projectId",created_by_id AS "createdById",project_manager_id AS "projectManagerId",stage,project_manager_status AS "projectManagerStatus"
          FROM petty_cash_expenses
          WHERE id=ANY($1::int[])
          ORDER BY id
          FOR UPDATE
        `, expenseIds);
        if (expenses.length !== expenseIds.length) throw new RouteError("expense_not_found", 404);
        if (expenses.some((expense) => Number(expense.createdById) !== userId && Number(expense.projectManagerId) !== userId && !isPlanning)) throw new RouteError("not_allowed", 403);
        if (expenses.some((expense) => expense.stage !== "completed" || expense.projectManagerStatus !== "approved")) throw new RouteError("expenses_not_project_manager_approved", 400);
        const projectIds = new Set(expenses.map((expense) => Number(expense.projectId)));
        if (projectIds.size !== 1) throw new RouteError("expenses_must_have_same_project", 400);
        const grouped = await tx.$queryRawUnsafe("SELECT expense_id FROM petty_cash_settlement_report_items WHERE expense_id=ANY($1::int[])", expenseIds);
        if (grouped.length) throw new RouteError("expense_already_grouped", 409);
        const placeholder = `TMP-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const inserted = await tx.$queryRawUnsafe(`
          INSERT INTO petty_cash_settlement_reports (report_number,project_id,created_by_id)
          VALUES ($1,$2,$3)
          RETURNING id,prepared_at AS "preparedAt"
        `, placeholder, [...projectIds][0], userId);
        const reportId = Number(inserted[0].id);
        const reportNumber = `PCR-${String(reportId).padStart(6, "0")}`;
        await tx.$executeRawUnsafe("UPDATE petty_cash_settlement_reports SET report_number=$1 WHERE id=$2", reportNumber, reportId);
        await tx.$executeRawUnsafe("INSERT INTO petty_cash_settlement_report_items (report_id,expense_id) SELECT $1,unnest($2::int[])", reportId, expenseIds);
        return { id: reportId, reportNumber, preparedAt: inserted[0].preparedAt, itemCount: expenseIds.length };
      });
      return json({ ok: true, item: report }, 201);
    }
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
    if (error instanceof RouteError) return json({ error: error.code }, error.status);
    if (error?.code === "P2002" || error?.code === "23505") return json({ error: "expense_already_grouped" }, 409);
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
      if (decision === "approve") {
        await prisma.$executeRawUnsafe("UPDATE petty_cash_expenses SET stage=$1,project_manager_status=$2,project_manager_by_id=$3,project_manager_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$4", nextStage, managerStatus, userId, id);
      } else {
        await prisma.$executeRawUnsafe("UPDATE petty_cash_expenses SET stage=$1,project_manager_status=$2,project_manager_by_id=$3,project_manager_at=CURRENT_TIMESTAMP,rejected_by_id=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$4", nextStage, managerStatus, userId, id);
      }
      return json({ ok: true });
    }
    return json({ error: "already_processed" }, 400);
  } catch (error) {
    console.error("petty_cash_expenses_patch_error", error);
    return json({ error: "internal_error" }, 500);
  }
}
