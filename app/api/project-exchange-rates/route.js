import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { hasPagePermission, requirePagePermission } from "../../../lib/pagePermissions";
import { getAuthenticatedUser } from "../../../lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const validYear = (year) => Number.isInteger(year) && year >= 1401 && year <= 1420;
let tablesReady;
function ensureTables() {
  if (!tablesReady) tablesReady = (async () => {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS project_exchange_rates (
      currency_id INTEGER NOT NULL, source_id INTEGER NOT NULL, year INTEGER NOT NULL,
      month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12), rate BIGINT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (currency_id, source_id, year, month)
    )`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS project_exchange_rate_history (
      id BIGSERIAL PRIMARY KEY, currency_id INTEGER NOT NULL, source_id INTEGER NOT NULL,
      year INTEGER NOT NULL, month INTEGER NOT NULL, old_rate BIGINT, new_rate BIGINT,
      actor_id INTEGER NOT NULL, actor_username TEXT, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  })().catch((error) => { tablesReady = undefined; throw error; });
  return tablesReady;
}

export async function GET(request) {
  const denied = await requirePagePermission(request, "کاربرگ مالی", "نمایش منو");
  if (denied && !await hasPagePermission(request, "پارامترهای مالی پروژه‌ها", "نمایش منو")) return denied;
  const year = Number(new URL(request.url).searchParams.get("year"));
  if (!validYear(year)) return json({ error: "invalid_year" }, 400);
  try {
    await ensureTables();
    const [currencies, sources, contractFinancials, rates] = await Promise.all([
      prisma.currencyType.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } }),
      prisma.currencySource.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } }),
      prisma.contractInformation.findMany({ where: { projectId: { not: null } }, select: { financial: true } }).catch((error) => {
        if (error?.code === "P2021") return [];
        throw error;
      }),
      prisma.$queryRaw`SELECT currency_id, source_id, month, rate FROM project_exchange_rates WHERE year = ${year}`,
    ]);
    const usedPairs = new Set();
    const normalizeLabel = (value) => String(value || "").replace(/ي/g, "ی").replace(/ك/g, "ک").trim().toLowerCase();
    const currencyIdsByLabel = new Map(currencies.map((currency) => [normalizeLabel(currency.title), Number(currency.id)]));
    const sourceIdsByLabel = new Map(sources.map((source) => [normalizeLabel(source.title), Number(source.id)]));
    const rialCurrency = currencies.find((currency) => /ریال|rial|﷼|(^|\s)irr(\s|$)/i.test(String(currency.title || "").replace(/ي/g, "ی").trim()));
    for (const { financial } of contractFinancials) {
      for (const section of [financial?.contractAmounts, financial?.appendices]) {
        if (!Array.isArray(section)) continue;
        for (const row of section) {
          if (!row || row.amount == null || String(row.amount).trim() === "") continue;
          let currencyId = Number(row.currencyId ?? row.currency_id);
          const currencyLabel = row.currencyLabel ?? row.currency_label ?? row.currencyName ?? row.currency_name;
          if (!Number.isInteger(currencyId) || currencyId <= 0) currencyId = currencyIdsByLabel.get(normalizeLabel(currencyLabel));
          if ((!Number.isInteger(currencyId) || currencyId <= 0) && (row.currencyIsRial || /ریال|rial|﷼|(^|\s)irr(\s|$)/i.test(normalizeLabel(currencyLabel)))) {
            currencyId = Number(rialCurrency?.id);
          }
          let sourceId = Number(row.sourceId ?? row.currencySourceId ?? row.source_id ?? row.currency_source_id);
          const sourceLabel = row.sourceLabel ?? row.currencySourceLabel ?? row.source_label ?? row.currency_source_label;
          if (!Number.isInteger(sourceId) || sourceId <= 0) sourceId = sourceIdsByLabel.get(normalizeLabel(sourceLabel));
          if (Number.isInteger(currencyId) && currencyId > 0 && Number.isInteger(sourceId) && sourceId > 0) {
            usedPairs.add(`${currencyId}:${sourceId}`);
          }
        }
      }
    }
    const currencyPairs = [...usedPairs].map((key) => {
      const [currencyId, sourceId] = key.split(":").map(Number);
      return { currencyId, sourceId };
    });
    return json({ currencies, sources, currencyPairs, rates: rates.map((row) => ({ currencyId: row.currency_id, sourceId: row.source_id, month: row.month, rate: row.rate == null ? "" : String(row.rate) })) });
  } catch (error) {
    console.error("project_exchange_rates_get", error);
    return json({ error: "load_failed" }, 500);
  }
}

export async function PUT(request) {
  const denied = await requirePagePermission(request, "پارامترهای مالی پروژه‌ها", "افزودن");
  if (denied) return denied;
  try {
    const actor = await getAuthenticatedUser(request);
    if (!actor) return json({ error: "forbidden" }, 403);
    const body = await request.json();
    const currencyId = Number(body.currencyId), sourceId = Number(body.sourceId), year = Number(body.year), month = Number(body.month);
    const rate = body.rate === "" ? null : String(body.rate);
    if (!Number.isInteger(currencyId) || currencyId <= 0 || !Number.isInteger(sourceId) || sourceId <= 0 || !validYear(year) || !Number.isInteger(month) || month < 1 || month > 12 || (rate !== null && !/^\d{1,18}$/.test(rate))) return json({ error: "invalid_value" }, 400);
    const current = Object.fromEntries(new Intl.DateTimeFormat("en-US-u-ca-persian", { timeZone: "Asia/Tehran", year: "numeric", month: "numeric" }).formatToParts(new Date()).map(({ type, value }) => [type, Number(value)]));
    if (year > current.year || (year === current.year && month > current.month)) return json({ error: "future_period" }, 400);
    await ensureTables();
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${currencyId}::int, ${sourceId}::int)::text`;
      const [currency, source] = await Promise.all([
        tx.currencyType.findUnique({ where: { id: currencyId }, select: { id: true } }),
        tx.currencySource.findUnique({ where: { id: sourceId }, select: { id: true } }),
      ]);
      if (!currency || !source) throw new Error("invalid_currency_source");
      const rows = await tx.$queryRaw`SELECT rate FROM project_exchange_rates WHERE currency_id = ${currencyId} AND source_id = ${sourceId} AND year = ${year} AND month = ${month}`;
      const previous = rows[0]?.rate == null ? null : String(rows[0].rate);
      const next = rate === null ? null : String(BigInt(rate));
      if (previous === next) return;
      await tx.$executeRaw`INSERT INTO project_exchange_rates (currency_id, source_id, year, month, rate) VALUES (${currencyId}, ${sourceId}, ${year}, ${month}, ${next}::bigint)
        ON CONFLICT (currency_id, source_id, year, month) DO UPDATE SET rate = EXCLUDED.rate, updated_at = NOW()`;
      await tx.$executeRaw`INSERT INTO project_exchange_rate_history (currency_id, source_id, year, month, old_rate, new_rate, actor_id, actor_username)
        VALUES (${currencyId}, ${sourceId}, ${year}, ${month}, ${previous}::bigint, ${next}::bigint, ${Number(actor.id)}, ${actor.username || null})`;
    });
    return json({ ok: true });
  } catch (error) {
    if (error.message === "invalid_currency_source") return json({ error: "invalid_currency_source" }, 400);
    console.error("project_exchange_rates_put", error);
    return json({ error: "save_failed" }, 500);
  }
}
