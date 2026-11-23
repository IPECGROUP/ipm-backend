import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requirePagePermission } from "../../../lib/pagePermissions";
import { formatMinorUnits, parseRequestedAmount } from "../../../lib/paymentAmount";
import { isPendingBudgetCommitment } from "../../../lib/budgetCommitment";

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

function jalaliYearMonth(value) {
  const normalized = String(value ?? "")
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .trim();
  const match = normalized.match(/^(\d{4})[/-](\d{1,2})(?:[/-]\d{1,2})?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year, month } : null;
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
  if (!item) return null;
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
      : item.project_code || item.project_name
        ? {
            id: Number(item.project_id ?? item.projectId),
            code: item.project_code ?? null,
            name: item.project_name ?? null,
            isActive: item.project_is_active ?? true,
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
    const consumptionYear = toPositiveInt(searchParams.get("consumption_year"));
    const allConsumption = searchParams.get("consumption_all") === "1";
    if (searchParams.has("consumption_year") && (!consumptionYear || consumptionYear < 1300 || consumptionYear > 1500)) {
      return json({ error: "invalid_consumption_year" }, 400);
    }

    const queryItems = () =>
      projectId
        ? prisma.$queryRaw`
            SELECT
              c.id,
              c.project_id,
              c.budget_code,
              c.budget_name,
              c.base_budget,
              c.created_at,
              c.updated_at,
              p.code AS project_code,
              p.name AS project_name,
              p.is_active AS project_is_active
            FROM cost_breakdown_items c
            LEFT JOIN projects p ON p.id = c.project_id
            WHERE c.project_id = ${projectId}
            ORDER BY c.budget_code ASC, c.id ASC
          `
        : prisma.$queryRaw`
            SELECT
              c.id,
              c.project_id,
              c.budget_code,
              c.budget_name,
              c.base_budget,
              c.created_at,
              c.updated_at,
              p.code AS project_code,
              p.name AS project_name,
              p.is_active AS project_is_active
            FROM cost_breakdown_items c
            LEFT JOIN projects p ON p.id = c.project_id
            ORDER BY c.project_id ASC, c.budget_code ASC, c.id ASC
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

    const usageByCode = {};
    const realizedUsageByCode = {};
    const commitmentByCode = {};
    const monthlyRealizedUsageByCode = {};
    const datedRealizedUsageByCode = {};
    let exchangeRates = [];
    if (projectId) {
      const usedMinorUnits = new Map();
      const realizedMinorUnits = new Map();
      const commitmentMinorUnits = new Map();
      const monthlyMinorUnits = new Map();
      const todayParts = new Intl.DateTimeFormat("en-US-u-ca-persian", { timeZone: "Asia/Tehran", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date());
      const today = Object.fromEntries(todayParts.map(({ type, value }) => [type, Number(value)]));
      const addMonthlyUsage = (codeValue, dateValue, amountMinorUnits) => {
        if (!consumptionYear && !allConsumption) return;
        const code = String(codeValue ?? "").trim();
        const date = jalaliYearMonth(dateValue);
        if (!code || !date || (!allConsumption && date.year !== consumptionYear)) return;
        if (allConsumption) {
          const normalizedDate = String(dateValue ?? "").replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
          const day = Number(normalizedDate.match(/^\d{4}[/-]\d{1,2}[/-](\d{1,2})/)?.[1] || 1);
          if (date.year * 10000 + date.month * 100 + day > today.year * 10000 + today.month * 100 + today.day) return;
        }
        const key = allConsumption ? `${code}\u0000${date.year}\u0000${date.month}` : `${code}\u0000${date.month}`;
        monthlyMinorUnits.set(key, (monthlyMinorUnits.get(key) || 0n) + amountMinorUnits);
      };
      const addUsage = (codeValue, amountValue, alreadyMinor = false, target = realizedMinorUnits) => {
        const code = String(codeValue ?? "").trim();
        if (!code) return;
        const amount = alreadyMinor
          ? (parseRequestedAmount(amountValue, true)?.minorUnits ?? 0n)
          : BigInt(String(amountValue || "0")) * 100n;
        usedMinorUnits.set(code, (usedMinorUnits.get(code) || 0n) + amount);
        if (target) target.set(code, (target.get(code) || 0n) + amount);
      };

      const paymentRequests = await prisma.paymentRequest.findMany({
        where: {
          projectId,
          scope: "projects",
          status: { in: ["pending", "approved"] },
          OR: [{ docId: null }, { docId: { notIn: ["supply_request", "tenkhah_request"] } }],
        },
        select: { budgetCode: true, amount: true, historyJson: true, status: true, dateJalali: true },
      });
      for (const request of paymentRequests) {
        const created = Array.isArray(request.historyJson)
          ? request.historyJson.find((entry) => entry?.type === "created")
          : null;
        const amount = created?.rialAmount ?? request.amount ?? 0;
        if (request.status === "approved") {
          addUsage(request.budgetCode, amount, true);
          const approvedMinorUnits = created?.rialAmount != null
            ? parseRequestedAmount(created.rialAmount, true)?.minorUnits
            : BigInt(String(request.amount ?? 0)) * 100n;
          if (approvedMinorUnits != null) addMonthlyUsage(request.budgetCode, request.dateJalali, approvedMinorUnits);
        } else if (isPendingBudgetCommitment(request)) {
          addUsage(request.budgetCode, amount, true, commitmentMinorUnits);
        } else {
          // Preserve the existing usageByCode response for other consumers.
          addUsage(request.budgetCode, amount, true, null);
        }
      }

      // Completed petty-cash expenses are the realized use of a budget line.
      // Amounts in both tables are already stored as converted rials.
      try {
        const expenses = await prisma.$queryRaw`
          SELECT budget_code AS code, COALESCE(SUM(amount), 0)::text AS total
          FROM petty_cash_expenses
          WHERE project_id = ${projectId} AND stage = 'completed'
          GROUP BY budget_code
        `;
        for (const expense of expenses || []) addUsage(expense.code, expense.total);
        if (consumptionYear || allConsumption) {
          const datedExpenses = await prisma.$queryRaw`SELECT budget_code AS code, expense_date AS "date", amount::text AS amount FROM petty_cash_expenses WHERE project_id = ${projectId} AND stage = 'completed'`;
          for (const expense of datedExpenses || []) addMonthlyUsage(expense.code, expense.date, BigInt(String(expense.amount ?? 0)) * 100n);
        }
      } catch (error) {
        if (!/petty_cash_expenses|does not exist|relation .* does not exist/i.test(String(error?.message || ""))) throw error;
      }

      // Include settlements created through the legacy tenkhah settlement flow.
      try {
        const settlementEntries = await prisma.$queryRaw`
          SELECT e.budget_code AS code, COALESCE(SUM(e.amount), 0)::text AS total
          FROM tenkhah_settlement_entries e
          INNER JOIN tenkhah_settlements s ON s.id = e.settlement_id
          INNER JOIN tenkhah_requests t ON t.id = s.tenkhah_request_id
          WHERE t.project_id = ${projectId} AND s.status = 'completed'
          GROUP BY e.budget_code
        `;
        for (const entry of settlementEntries || []) addUsage(entry.code, entry.total);
        if (consumptionYear || allConsumption) {
          const monthlyEntries = await prisma.$queryRaw`
            SELECT e.budget_code AS code, e.expense_date AS "date", e.amount::text AS amount
            FROM tenkhah_settlement_entries e
            INNER JOIN tenkhah_settlements s ON s.id = e.settlement_id
            INNER JOIN tenkhah_requests t ON t.id = s.tenkhah_request_id
            WHERE t.project_id = ${projectId} AND s.status = 'completed'
          `;
          for (const entry of monthlyEntries || []) {
            addMonthlyUsage(entry.code, entry.date, BigInt(String(entry.amount ?? 0)) * 100n);
          }
        }
      } catch (error) {
        if (!/tenkhah_settlement_entries|tenkhah_settlements|tenkhah_requests|does not exist|relation .* does not exist/i.test(String(error?.message || ""))) throw error;
      }

      for (const [code, amount] of usedMinorUnits) usageByCode[code] = formatMinorUnits(amount);
      for (const [code, amount] of realizedMinorUnits) realizedUsageByCode[code] = formatMinorUnits(amount);
      for (const [code, amount] of commitmentMinorUnits) commitmentByCode[code] = formatMinorUnits(amount);
      for (const [key, amount] of monthlyMinorUnits) {
        const [code, first, second] = key.split("\u0000");
        if (allConsumption) ((datedRealizedUsageByCode[code] ??= {})[first] ??= {})[second] = formatMinorUnits(amount);
        else (monthlyRealizedUsageByCode[code] ??= {})[first] = formatMinorUnits(amount);
      }
      if (consumptionYear || allConsumption) {
        try {
          const rates = await prisma.$queryRaw`
            SELECT currency_id AS "currencyId", source_id AS "sourceId", year, month, rate::text AS rate
            FROM project_exchange_rates
            WHERE (${allConsumption} OR year = ${consumptionYear}) AND rate IS NOT NULL
          `;
          exchangeRates = (rates || []).map((rate) => ({
            currencyId: rate.currencyId,
            sourceId: rate.sourceId,
            year: rate.year,
            month: rate.month,
            rate: rate.rate,
          }));
        } catch (error) {
          if (!/project_exchange_rates|does not exist|relation .* does not exist/i.test(String(error?.message || ""))) throw error;
        }
      }
    }

    return json({ items: items.map(serializeItem), usageByCode, realizedUsageByCode, commitmentByCode, monthlyRealizedUsageByCode, datedRealizedUsageByCode, exchangeRates });
  } catch (e) {
    console.error("cost_breakdown_get_error", e);
    return json({ error: "internal_error" }, 500);
  }
}

export async function POST(req) {
  const denied = await requirePagePermission(req, "ساختار شکست هزینه‌ها", "افزودن");
  if (denied) return denied;
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
      INSERT INTO cost_breakdown_items (project_id, budget_code, budget_name, base_budget, updated_at)
      VALUES (${projectId}, ${budgetCode}, ${budgetName}, ${baseBudget}, CURRENT_TIMESTAMP)
      ON CONFLICT (project_id, budget_code)
      DO UPDATE SET
        budget_name = EXCLUDED.budget_name,
        base_budget = EXCLUDED.base_budget,
        updated_at = CURRENT_TIMESTAMP
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
  const denied = await requirePagePermission(req, "ساختار شکست هزینه‌ها", "افزودن");
  if (denied) return denied;
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
  const denied = await requirePagePermission(req, "ساختار شکست هزینه‌ها", "حذف");
  if (denied) return denied;
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
