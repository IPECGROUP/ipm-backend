import { prisma } from "../../../lib/prisma";

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
  return projectId == null ? "reserve" : String(projectId);
}

function projectManagerApproved(history) {
  return Array.isArray(history) && history.some((entry) =>
    entry?.type === "approved" && entry?.roleKey === "project_manager" && Number(entry?.index) === 2
  );
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

function finalPaidAmount(request) {
  const saved = BigInt(request.cashAmount || 0) + BigInt(request.creditAmount || 0);
  return saved > 0n ? saved : amountFromFinalNote(request.historyJson);
}

export async function GET() {
  try {
    const [allocations, selectedRows, requests] = await Promise.all([
      prisma.liquidityAllocation.groupBy({ by: ["projectId"], _sum: { amount: true } }),
      prisma.liquidityAllocation.findMany({
        where: { projectId: { not: null } },
        distinct: ["projectId"],
        select: { projectId: true },
      }),
      prisma.paymentRequest.findMany({
        where: { projectId: { not: null } },
        select: { projectId: true, amount: true, cashAmount: true, creditAmount: true, status: true, historyJson: true },
      }),
    ]);

    const projectIds = selectedRows.map((row) => row.projectId).filter((id) => id != null);
    const projectRecords = projectIds.length
      ? await prisma.project.findMany({ where: { id: { in: projectIds } }, orderBy: { code: "asc" } })
      : [];
    const result = { allocations: {}, spent: {}, committed: {}, expenseCount: {}, projects: [] };
    for (const row of allocations) result.allocations[mapKey(row.projectId)] = amountText(row._sum.amount);
    for (const request of requests) {
      const key = mapKey(request.projectId);
      const amount = BigInt(request.amount || 0);
      if (projectManagerApproved(request.historyJson)) {
        result.committed[key] = amountText(BigInt(result.committed[key] || 0) + amount);
      }
      if (request.status === "approved") {
        const paid = finalPaidAmount(request);
        result.spent[key] = amountText(BigInt(result.spent[key] || 0) + paid);
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
    return json(result);
  } catch (error) {
    return json({ error: "internal_error", message: String(error?.message || "internal_error") }, 500);
  }
}

export async function POST(request) {
  const userId = await getUserId(request);
  if (!userId) return json({ error: "unauthorized" }, 401);
  try {
    const body = await request.json().catch(() => ({}));
    const allocationDate = String(body?.allocationDate || "").trim();
    const source = String(body?.source || "").trim();
    const availableAmount = toBigInt(body?.availableAmount);
    const description = String(body?.description || "").trim();
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    const parsedRows = rows.map((row) => ({ projectId: row?.projectId == null ? null : Number(row.projectId), amount: toBigInt(row?.amount) }))
      .filter((row) => (row.projectId == null || Number.isInteger(row.projectId)) && row.amount != null && row.amount !== 0n);
    if (!allocationDate || !source || availableAmount == null || availableAmount <= 0n || !parsedRows.length) {
      return json({ error: "invalid_input" }, 400);
    }
    const total = parsedRows.reduce((sum, row) => sum + row.amount, 0n);
    if (total > availableAmount) return json({ error: "allocation_exceeds_available" }, 400);

    await prisma.liquidityAllocation.createMany({
      data: parsedRows.map((row) => ({ allocationDate, source, availableAmount, description, projectId: row.projectId, amount: row.amount, createdById: userId })),
    });
    return json({ ok: true });
  } catch (error) {
    return json({ error: "internal_error", message: String(error?.message || "internal_error") }, 500);
  }
}
