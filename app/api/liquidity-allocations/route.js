import { prisma } from "../../../lib/prisma";
import { hasPagePermission, requirePagePermission } from "../../../lib/pagePermissions";
import { formatMinorUnits, parseRequestedAmount } from "../../../lib/paymentAmount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data, status = 200) {
  return Response.json(data, { status });
}

function readCookieValue(cookie, name) {
  const match = String(cookie || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function getUserId(request) {
  const direct = request.headers.get("x-user-id") || readCookieValue(request.headers.get("cookie"), "user_id");
  if (direct && /^\d+$/.test(direct)) return Number(direct);
  const sessionId = readCookieValue(request.headers.get("cookie"), "ipm_session");
  if (sessionId) {
    try {
      const session = await prisma.session.findUnique({ where: { id: sessionId } });
      if (session?.userId && (!session.expiresAt || new Date(session.expiresAt).getTime() >= Date.now())) return Number(session.userId);
    } catch {}
  }
  return process.env.NODE_ENV !== "production" ? 1 : null;
}

function toBigInt(value) {
  const text = String(value ?? "").replace(/[\s,]/g, "").trim();
  if (!/^-?\d+$/.test(text)) return null;
  try { return BigInt(text); } catch { return null; }
}

function amountText(value) {
  return String(value ?? 0);
}

function mapKey(projectId) {
  return projectId == null ? null : String(projectId);
}

function projectManagerApproved(history) {
  return Array.isArray(history) && history.some((entry) =>
    entry?.type === "approved" && entry?.roleKey === "project_manager" && Number(entry?.index) === 2
  );
}

function isProjectCommitment(request) {
  // A completed payment is always a project commitment, even for legacy or
  // shortened workflows that do not contain the exact project-manager step.
  // Pending requests become commitments only after project-manager approval;
  // returned/rejected requests must release the reserved liquidity.
  return request?.status === "approved"
    || (request?.status === "pending" && projectManagerApproved(request?.historyJson));
}

function normalizeDigits(value) {
  return String(value ?? "")
    .replace(/[۰-۹]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹".indexOf(digit))
    .replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit));
}

function amountFromFinalNote(history) {
  const finalAction = Array.isArray(history)
    ? [...history].reverse().find((entry) => entry?.type === "approved" && Number(entry?.index) >= 5)
    : null;
  const note = normalizeDigits(finalAction?.note || "");
  const patterns = [/پرداخت نقدی:\s*([\d,]+)/g, /پرداخت اعتباری:\s*([\d,]+)/g];
  let total = 0n;
  for (const pattern of patterns) {
    for (const match of note.matchAll(pattern)) total += BigInt(String(match[1] || "0").replace(/,/g, ""));
  }
  return total;
}

function requestedRialMinorUnits(request) {
  const createdMeta = Array.isArray(request.historyJson)
    ? request.historyJson.find((entry) => entry?.type === "created")
    : null;
  const savedRialAmount = parseRequestedAmount(createdMeta?.rialAmount, true)?.minorUnits;
  if (savedRialAmount != null) return savedRialAmount;

  const isForeignCurrency = request.currencyTypeId != null;
  const requestedAmount = parseRequestedAmount(
    createdMeta?.requestAmount ?? request.amount ?? 0,
    isForeignCurrency,
  );
  if (!requestedAmount) return 0n;
  if (!isForeignCurrency) return requestedAmount.minorUnits;

  const exchangeRate = toBigInt(createdMeta?.exchangeRate);
  return exchangeRate != null && exchangeRate > 0n
    ? requestedAmount.minorUnits * exchangeRate
    : 0n;
}

function finalPaidMinorUnits(request) {
  // Final-payment inputs are recorded in their selected currency. For a
  // foreign-currency request, using those raw values as Rials made (for
  // example) USD 2 reduce project liquidity by only 2 Rials. The request's
  // exact converted Rial amount is the canonical project expense.
  if (request.currencyTypeId != null) return requestedRialMinorUnits(request);

  const saved = BigInt(request.cashAmount || 0) + BigInt(request.creditAmount || 0);
  if (saved > 0n) return saved * 100n;
  const noted = amountFromFinalNote(request.historyJson);
  return noted > 0n ? noted * 100n : requestedRialMinorUnits(request);
}

async function isAdmin(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, email: true, role: true } });
  const username = String(user?.username || "").toLowerCase();
  const email = String(user?.email || "").toLowerCase();
  return user?.role === "admin" || username === "marandi" || email === "marandi@ipecgroup.net";
}

let liquidityTableReady;
async function ensureLiquidityTable() {
  if (!liquidityTableReady) {
    liquidityTableReady = (async () => {
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
          batch_id VARCHAR(80),
          row_type VARCHAR(20) NOT NULL DEFAULT 'project',
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await prisma.$executeRawUnsafe("ALTER TABLE liquidity_allocations ADD COLUMN IF NOT EXISTS batch_id VARCHAR(80)");
      await prisma.$executeRawUnsafe("ALTER TABLE liquidity_allocations ADD COLUMN IF NOT EXISTS row_type VARCHAR(20) NOT NULL DEFAULT 'project'");
      // Project-less rows created by earlier versions stored the contingency
      // balance.  Preserve them under their explicit row type.
      await prisma.$executeRawUnsafe("UPDATE liquidity_allocations SET row_type = 'contingency_reserve' WHERE project_id IS NULL AND row_type = 'project'");
      await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS liquidity_allocations_project_id_idx ON liquidity_allocations(project_id)");
      await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS liquidity_allocations_batch_id_idx ON liquidity_allocations(batch_id)");
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS financial_dashboard_resets (
          id SERIAL PRIMARY KEY,
          reset_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          reset_by INTEGER
        )
      `);
    })();
  }
  return liquidityTableReady;
}

export async function GET(request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const requestedProjectId = Number(searchParams.get("projectId") || searchParams.get("project_id"));
    const canViewLiquidity = await hasPagePermission(request, "تخصیص نقدینگی", "نمایش منو");
    // A payment requester may see the read-only balance of the project being
    // selected, without being allowed to open the liquidity allocation page or
    // read balances/history of other projects.
    if (!canViewLiquidity) {
      const canViewPayment = Number.isInteger(requestedProjectId) && requestedProjectId > 0
        ? await hasPagePermission(request, "درخواست پرداخت", "نمایش منو")
        : false;
      if (!canViewPayment) return json({ error: "forbidden" }, 403);
    }
    await ensureLiquidityTable();
    // A dashboard reset is intentionally view-only.  The liquidity page and
    // payment-request validation must always use the real, current balances.
    const dashboardView = searchParams.get("dashboard") === "1";
    const resets = dashboardView
      ? await prisma.$queryRawUnsafe("SELECT reset_at AS \"resetAt\" FROM financial_dashboard_resets ORDER BY id DESC LIMIT 1")
      : [];
    const resetAt = resets?.[0]?.resetAt ? new Date(resets[0].resetAt) : null;
    const [allocations, selectedRows, requests, historyRows] = await Promise.all([
      resetAt
        ? prisma.$queryRawUnsafe("SELECT project_id AS \"projectId\", COALESCE(SUM(amount), 0)::text AS amount FROM liquidity_allocations WHERE created_at > $1 GROUP BY project_id", resetAt)
        : prisma.$queryRawUnsafe("SELECT project_id AS \"projectId\", COALESCE(SUM(amount), 0)::text AS amount FROM liquidity_allocations GROUP BY project_id"),
      resetAt
        ? prisma.$queryRawUnsafe("SELECT DISTINCT project_id AS \"projectId\" FROM liquidity_allocations WHERE project_id IS NOT NULL AND created_at > $1", resetAt)
        : prisma.$queryRawUnsafe("SELECT DISTINCT project_id AS \"projectId\" FROM liquidity_allocations WHERE project_id IS NOT NULL"),
      prisma.paymentRequest.findMany({
        where: { projectId: { not: null }, ...(resetAt ? { createdAt: { gt: resetAt } } : {}) },
        select: { projectId: true, currencyTypeId: true, amount: true, cashAmount: true, creditAmount: true, status: true, historyJson: true },
      }),
      prisma.$queryRawUnsafe(`
        SELECT id, batch_id AS "batchId", allocation_date AS "allocationDate", source,
          available_amount::text AS "availableAmount", description, project_id AS "projectId",
          amount::text AS amount, row_type AS "rowType", created_at AS "createdAt"
        FROM liquidity_allocations
        ORDER BY created_at DESC, id DESC
      `),
    ]);

    const projectIds = selectedRows.map((row) => row.projectId).filter((id) => id != null);
    const projectRecords = projectIds.length
      ? await prisma.project.findMany({ where: { id: { in: projectIds } }, orderBy: { code: "asc" } })
      : [];
    const result = { allocations: {}, spent: {}, committed: {}, expenseCount: {}, projects: [], history: [], contingencyReserve: "0" };
    for (const row of allocations) {
      const key = mapKey(row.projectId);
      if (key != null) result.allocations[key] = amountText(row.amount);
    }
    for (const request of requests) {
      const key = mapKey(request.projectId);
      const createdMeta = Array.isArray(request.historyJson) ? request.historyJson.find((entry) => entry?.type === "created") : null;
      const amountMinorUnits = parseRequestedAmount(createdMeta?.rialAmount ?? request.amount ?? 0, true)?.minorUnits ?? 0n;
      if (isProjectCommitment(request)) {
        const previousMinorUnits = parseRequestedAmount(result.committed[key] || 0, true)?.minorUnits ?? 0n;
        result.committed[key] = formatMinorUnits(previousMinorUnits + amountMinorUnits);
      }
      if (request.status === "approved") {
        const paidMinorUnits = finalPaidMinorUnits(request);
        const previousMinorUnits = parseRequestedAmount(result.spent[key] || 0, true)?.minorUnits ?? 0n;
        result.spent[key] = formatMinorUnits(previousMinorUnits + paidMinorUnits);
        result.expenseCount[key] = Number(result.expenseCount[key] || 0) + 1;
      }
    }
    result.projects = projectRecords.map((project) => {
      const key = String(project.id);
      return {
        id: project.id,
        code: project.code,
        name: project.name,
        totalBudget: result.allocations[key] || "0",
        totalCommitments: result.committed[key] || "0",
        totalExpenses: result.spent[key] || "0",
        expenseCount: result.expenseCount[key] || 0,
      };
    });
    const projectById = new Map(projectRecords.map((project) => [String(project.id), project]));
    const historyByBatch = new Map();
    for (const row of historyRows) {
      if (row.rowType === "contingency_reserve") {
        result.contingencyReserve = amountText(BigInt(result.contingencyReserve || 0) + BigInt(row.amount || 0));
      }
      const batchId = String(row.batchId || `legacy-${row.id}`);
      if (!historyByBatch.has(batchId)) {
        historyByBatch.set(batchId, {
          id: batchId,
          allocationDate: row.allocationDate,
          source: row.source,
          availableAmount: amountText(row.availableAmount),
          allocatedAmount: "0",
          totalAmount: "0",
          contingencyReserveAmount: "0",
          description: row.description || "",
          createdAt: row.createdAt,
          details: [],
        });
      }
      const batch = historyByBatch.get(batchId);
      if (row.rowType === "contingency_reserve") {
        batch.contingencyReserveAmount = amountText(BigInt(batch.contingencyReserveAmount || 0) + BigInt(row.amount || 0));
        continue;
      }
      // The total row is stored separately from project allocations so the
      // allocation total remains the sum of project-assigned amounts.
      if (row.rowType === "total" || row.projectId == null) {
        batch.totalAmount = amountText(BigInt(batch.totalAmount || 0) + BigInt(row.amount || 0));
        continue;
      }
      batch.allocatedAmount = amountText(BigInt(batch.allocatedAmount || 0) + BigInt(row.amount || 0));
      const detailKey = mapKey(row.projectId);
      const existingDetail = batch.details.find((detail) => mapKey(detail.projectId) === detailKey);
      if (existingDetail) existingDetail.amount = amountText(BigInt(existingDetail.amount || 0) + BigInt(row.amount || 0));
      else {
        const project = row.projectId == null ? null : projectById.get(String(row.projectId));
        batch.details.push({
          projectId: row.projectId,
          project: project ? { id: project.id, code: project.code, name: project.name } : null,
          amount: amountText(row.amount),
        });
      }
    }
    result.history = Array.from(historyByBatch.values());
    if (!canViewLiquidity) {
      const key = String(requestedProjectId);
      result.allocations = { [key]: result.allocations[key] || "0" };
      result.spent = { [key]: result.spent[key] || "0" };
      result.committed = { [key]: result.committed[key] || "0" };
      result.expenseCount = { [key]: result.expenseCount[key] || 0 };
      result.projects = result.projects.filter((project) => String(project.id) === key);
      result.history = [];
      result.contingencyReserve = "0";
    }
    return json(result);
  } catch (error) {
    return json({ error: "internal_error", message: String(error?.message || "internal_error") }, 500);
  }
}

export async function POST(request) {
  const denied = await requirePagePermission(request, "تخصیص نقدینگی", "افزودن");
  if (denied) return denied;
  const userId = await getUserId(request);
  if (!userId) return json({ error: "unauthorized" }, 401);
  try {
    await ensureLiquidityTable();
    const body = await request.json().catch(() => ({}));
    const allocationDate = String(body?.allocationDate || "").trim();
    const source = String(body?.source || "").trim();
    const availableAmount = toBigInt(body?.availableAmount);
    const reserveAdjustment = toBigInt(body?.reserveAdjustment) ?? 0n;
    const batchId = String(body?.batchId || "").trim().slice(0, 80) || null;
    const description = String(body?.description || "").trim();
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    const parsedRows = rows.map((row) => ({ projectId: Number(row?.projectId), amount: toBigInt(row?.amount) }))
      .filter((row) => Number.isInteger(row.projectId) && row.projectId > 0 && row.amount != null && row.amount !== 0n);
    if (!allocationDate || !source || availableAmount == null || availableAmount <= 0n || (!parsedRows.length && reserveAdjustment === 0n)) {
      return json({ error: "invalid_input" }, 400);
    }
    const allocationTotal = parsedRows.reduce((total, row) => total + row.amount, 0n);
    const existingBatchRows = batchId
      ? await prisma.$queryRawUnsafe("SELECT COALESCE(SUM(amount), 0)::text AS amount FROM liquidity_allocations WHERE batch_id = $1 AND row_type = 'project'", batchId)
      : [];
    const existingBatchTotal = BigInt(existingBatchRows?.[0]?.amount || 0);
    if (existingBatchTotal + allocationTotal > availableAmount) {
      return json({ error: "allocation_total_exceeds_available_amount" }, 400);
    }
    const contingencyReserveAmount = availableAmount - existingBatchTotal - allocationTotal + reserveAdjustment;
    if (contingencyReserveAmount < 0n) {
      return json({ error: "contingency_reserve_cannot_be_negative" }, 400);
    }
    await prisma.$transaction(async (tx) => {
      for (const row of parsedRows) {
        await tx.$executeRawUnsafe(
          "INSERT INTO liquidity_allocations (allocation_date, source, available_amount, description, project_id, amount, created_by, batch_id) VALUES ($1, $2, $3::bigint, $4, $5, $6::bigint, $7, $8)",
          allocationDate,
          source,
          String(availableAmount),
          description,
          row.projectId,
          String(row.amount),
          userId,
          batchId,
        );
      }
      await tx.$executeRawUnsafe(
        "INSERT INTO liquidity_allocations (allocation_date, source, available_amount, description, project_id, amount, created_by, batch_id, row_type) VALUES ($1, $2, $3::bigint, $4, NULL, $5::bigint, $6, $7, 'total')",
        allocationDate,
        source,
        String(availableAmount),
        description,
        String(allocationTotal),
        userId,
        batchId,
      );
      await tx.$executeRawUnsafe(
        "INSERT INTO liquidity_allocations (allocation_date, source, available_amount, description, project_id, amount, created_by, batch_id, row_type) VALUES ($1, $2, $3::bigint, $4, NULL, $5::bigint, $6, $7, 'contingency_reserve')",
        allocationDate,
        source,
        String(availableAmount),
        description,
        String(contingencyReserveAmount),
        userId,
        batchId,
      );
    });
    return json({ ok: true });
  } catch (error) {
    return json({ error: "internal_error", message: String(error?.message || "internal_error") }, 500);
  }
}

export async function DELETE(request) {
  const denied = await requirePagePermission(request, "تخصیص نقدینگی", "افزودن");
  if (denied) return denied;
  const userId = await getUserId(request);
  if (!userId) return json({ error: "unauthorized" }, 401);
  if (!(await isAdmin(userId))) return json({ error: "forbidden" }, 403);
  try {
    await ensureLiquidityTable();
    const result = await prisma.$executeRawUnsafe("DELETE FROM liquidity_allocations");
    return json({ ok: true, deleted: Number(result || 0) });
  } catch (error) {
    return json({ error: "internal_error", message: String(error?.message || "internal_error") }, 500);
  }
}
