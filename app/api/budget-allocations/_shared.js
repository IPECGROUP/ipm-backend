import { prisma } from "@/lib/prisma";

export const ALLOWED_KINDS = new Set([
  "office",
  "site",
  "finance",
  "cash",
  "capex",
  "projects",
]);

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function toEnDigits(s) {
  return String(s ?? "")
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function qIdent(name) {
  return `"${String(name || "").replace(/"/g, "\"\"")}"`;
}

export function toIntOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const en = toEnDigits(v);
  const n = Number(String(en).replace(/[^\d-]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

export function toIntOrZero(v) {
  const n = toIntOrNull(v);
  return n == null ? 0 : n;
}

export function parseKindProject(params, { projectRequiredForProjects = false } = {}) {
  const kind = String(params.get("kind") || "").trim().toLowerCase();
  if (!ALLOWED_KINDS.has(kind)) {
    return { error: "invalid_kind", kind: null, projectId: null };
  }

  if (kind !== "projects") {
    return { error: null, kind, projectId: null };
  }

  const raw = params.get("project_id");
  const projectId = toIntOrNull(raw);

  if (projectRequiredForProjects && !projectId) {
    return { error: "project_id_required", kind, projectId: null };
  }

  return { error: null, kind, projectId: projectId || null };
}

function toSafeNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "bigint") return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeAmount(v) {
  return toSafeNumber(v);
}

export function toIso(v) {
  if (!v) return null;
  try {
    return new Date(v).toISOString();
  } catch {
    return null;
  }
}

function jalaliNowParts() {
  let y4 = "1400";
  let m2 = "01";
  let d2 = "01";

  try {
    const df = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = df.formatToParts(new Date());
    const yRaw = parts.find((p) => p.type === "year")?.value || "1400";
    const mRaw = parts.find((p) => p.type === "month")?.value || "01";
    const dRaw = parts.find((p) => p.type === "day")?.value || "01";
    const y = toEnDigits(yRaw).replace(/[^\d]/g, "");
    const m = toEnDigits(mRaw).replace(/[^\d]/g, "");
    const d = toEnDigits(dRaw).replace(/[^\d]/g, "");
    if (y) y4 = y;
    if (m) m2 = String(Number(m)).padStart(2, "0");
    if (d) d2 = String(Number(d)).padStart(2, "0");
  } catch {}

  const y2 = (y4.slice(-2) || "00").padStart(2, "0");
  return {
    y4,
    y2,
    m2,
    d2,
    dateJalali: `${y4}/${m2}/${d2}`,
  };
}

async function runDdl(sql) {
  await prisma.$executeRawUnsafe(sql);
}

export async function ensureAllocTable() {
  if (globalThis.__budgetAllocTableReady) return;

  await runDdl(`
    CREATE TABLE IF NOT EXISTS budget_allocations (
      id BIGSERIAL PRIMARY KEY,
      serial TEXT NOT NULL,
      date_jalali TEXT NULL,
      kind TEXT NOT NULL,
      project_id BIGINT NULL,
      project_name TEXT NULL,
      code TEXT NOT NULL,
      amount BIGINT NOT NULL DEFAULT 0,
      description TEXT NULL,
      "desc" TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Keep compatibility with older deployments that may have partial schema.
  await runDdl(`ALTER TABLE budget_allocations ADD COLUMN IF NOT EXISTS date_jalali TEXT NULL`);
  await runDdl(`ALTER TABLE budget_allocations ADD COLUMN IF NOT EXISTS kind TEXT NULL`);
  await runDdl(`ALTER TABLE budget_allocations ADD COLUMN IF NOT EXISTS project_id BIGINT NULL`);
  await runDdl(`ALTER TABLE budget_allocations ADD COLUMN IF NOT EXISTS project_name TEXT NULL`);
  await runDdl(`ALTER TABLE budget_allocations ADD COLUMN IF NOT EXISTS code TEXT NULL`);
  await runDdl(`ALTER TABLE budget_allocations ADD COLUMN IF NOT EXISTS amount BIGINT NULL`);
  await runDdl(`ALTER TABLE budget_allocations ADD COLUMN IF NOT EXISTS alloc BIGINT NULL`);
  await runDdl(`ALTER TABLE budget_allocations ADD COLUMN IF NOT EXISTS description TEXT NULL`);
  await runDdl(`ALTER TABLE budget_allocations ADD COLUMN IF NOT EXISTS "desc" TEXT NULL`);
  await runDdl(`ALTER TABLE budget_allocations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL`);

  await runDdl(`
    CREATE INDEX IF NOT EXISTS idx_budget_allocations_kind_project_code_created_at
    ON budget_allocations(kind, project_id, code, created_at DESC)
  `);

  await runDdl(`
    CREATE INDEX IF NOT EXISTS idx_budget_allocations_kind_project_created_at
    ON budget_allocations(kind, project_id, created_at DESC)
  `);

  await runDdl(`
    CREATE INDEX IF NOT EXISTS idx_budget_allocations_serial
    ON budget_allocations(serial)
  `);

  globalThis.__budgetAllocTableReady = true;
}

export async function getAllocColumnSet() {
  await ensureAllocTable();

  const cache = globalThis.__budgetAllocColsCache;
  const now = Date.now();
  if (cache && now - Number(cache.ts || 0) < 30_000 && cache.set instanceof Set) {
    return cache.set;
  }

  const rows = await prisma.$queryRawUnsafe(`
    SELECT column_name::text AS column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'budget_allocations'
  `);

  const set = new Set((rows || []).map((r) => String(r?.column_name || "").trim()).filter(Boolean));
  globalThis.__budgetAllocColsCache = { ts: now, set };
  return set;
}

export function pickAllocAmountColumn(cols) {
  const has = (name) => cols instanceof Set && cols.has(name);
  if (has("amount")) return "amount";
  if (has("alloc")) return "alloc";
  if (has("allocation")) return "allocation";
  return null;
}

export function amountAsSafeBigIntExpr(cols) {
  const amountCol = pickAllocAmountColumn(cols);
  if (!amountCol) return "0::bigint";
  const colExpr = qIdent(amountCol);
  const signedDigits = `(CASE WHEN COALESCE(${colExpr}::text, '') LIKE '-%' THEN '-' ELSE '' END) || REGEXP_REPLACE(COALESCE(${colExpr}::text, ''), '[^0-9]', '', 'g')`;
  return `COALESCE(NULLIF(NULLIF(${signedDigits}, ''), '-'), '0')::bigint`;
}

export async function makeNextSerial() {
  await ensureAllocTable();

  const { y2, m2, dateJalali } = jalaliNowParts();
  const prefix = `BA${y2}${m2}`;
  const like = `${prefix}%`;
  const regex = `^${prefix}[0-9]{3}$`;

  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        COALESCE(
          MAX(
            CASE
              WHEN serial ~ $1 THEN CAST(RIGHT(serial, 3) AS INTEGER)
              ELSE 0
            END
          ),
          0
        ) AS max_seq
      FROM budget_allocations
      WHERE serial LIKE $2
    `,
    regex,
    like,
  );

  const maxSeq = toSafeNumber(rows?.[0]?.max_seq || 0);
  const nextSeq = maxSeq + 1;
  const serial = `${prefix}${String(nextSeq).padStart(3, "0")}`;

  return { serial, date_jalali: dateJalali };
}
