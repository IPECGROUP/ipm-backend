// app/api/budget-estimates/route.js
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;
const prisma =
  globalForPrisma.__prisma ||
  new PrismaClient({
    log: ["error"],
  });
if (process.env.NODE_ENV !== "production") globalForPrisma.__prisma = prisma;

const ALLOWED = new Set(["office", "site", "finance", "cash", "capex", "projects"]);

const json = (data, init) =>
  new Response(JSON.stringify(data), {
    status: init?.status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(init?.headers || {}) },
  });

const toBigIntSafe = (v) => {
  try {
    if (v === null || v === undefined || v === "") return null;
    return BigInt(String(v));
  } catch {
    return null;
  }
};

const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

const latestPerCode = (rows) => {
  const map = new Map();
  for (const r of rows || []) {
    const code = String(r?.code || "").trim();
    if (!code) continue;
    if (!map.has(code)) {
      map.set(code, {
        code,
        last_amount: Number(r?.amount || 0),
        last_desc: r?.description ?? "",
      });
    }
  }
  return map;
};

async function buildItems({ kind, projectId }) {
  let baseCode = "";
  if (kind === "projects") {
    const p = await prisma.project.findFirst({
      where: { id: projectId },
      select: { code: true },
    });
    baseCode = String(p?.code || "").trim();
    if (!baseCode) return [];
  }

  const centers = await prisma.center.findMany({
    where:
      kind === "projects"
        ? {
            kind: "projects",
            OR: [{ suffix: baseCode }, { suffix: { startsWith: baseCode + "." } }],
          }
        : { kind },
    select: { suffix: true, description: true },
    orderBy: [{ suffix: "asc" }, { id: "asc" }],
  });

  const estRows = await prisma.budgetEstimate.findMany({
    where: {
      kind,
      projectId: kind === "projects" ? projectId : null,
    },
    select: { code: true, amount: true, description: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }],
  });

  const latestMap = latestPerCode(estRows);

  const items = [];
  const seen = new Set();

  for (const c of centers || []) {
    const code = String(c?.suffix || "").trim();
    if (!code) continue;
    seen.add(code);
    const hit = latestMap.get(code);
    items.push({
      code,
      center_desc: c?.description || "",
      last_desc: hit ? hit.last_desc : "",
      last_amount: hit ? hit.last_amount : 0,
    });
  }

  for (const [code, hit] of latestMap.entries()) {
    if (seen.has(code)) continue;
    items.push({
      code,
      center_desc: "",
      last_desc: hit?.last_desc ?? "",
      last_amount: hit?.last_amount ?? 0,
    });
  }

  items.sort((a, b) =>
    String(a.code || "").localeCompare(String(b.code || ""), "fa", {
      numeric: true,
      sensitivity: "base",
    }),
  );

  return items;
}

async function buildHistory({ kind, projectId }) {
  const rows = await prisma.budgetEstimate.findMany({
    where: {
      kind,
      projectId: kind === "projects" ? projectId : null,
    },
    select: { code: true, amount: true, description: true, createdAt: true },
    orderBy: [{ code: "asc" }, { createdAt: "desc" }],
  });

  const history = {};
  for (const r of rows || []) {
    const code = String(r?.code || "").trim();
    if (!code) continue;
    if (!history[code]) history[code] = [];
    history[code].push({
      amount: Number(r?.amount || 0),
      desc: r?.description ?? null,
      created_at: r?.createdAt ? new Date(r.createdAt).toISOString() : null,
    });
  }

  return history;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const kind = String(searchParams.get("kind") || "").trim();
  const projectIdRaw = searchParams.get("project_id");
  const historyMode =
    searchParams.get("history") === "1" ||
    searchParams.get("history") === "true" ||
    searchParams.get("mode") === "history";

  if (!ALLOWED.has(kind)) return json({ error: "invalid_kind" }, { status: 400 });

  const projectId = projectIdRaw ? toBigIntSafe(projectIdRaw) : null;
  if (kind === "projects" && !projectId) {
    return historyMode ? json({ history: {} }) : json({ items: [] });
  }

  if (historyMode) {
    const history = await buildHistory({ kind, projectId });
    return json({ history });
  }

  const items = await buildItems({ kind, projectId });
  return json({ items });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const kind = String(body?.kind || "").trim();
  const projectId = body?.project_id == null ? null : toBigIntSafe(body.project_id);
  const rows = Array.isArray(body?.rows) ? body.rows : [];

  if (!ALLOWED.has(kind)) return json({ error: "invalid_kind" }, { status: 400 });
  if (kind === "projects" && !projectId)
    return json({ error: "project_id_required" }, { status: 400 });

  const data = rows
    .map((r) => ({
      kind,
      projectId: kind === "projects" ? projectId : null,
      code: String(r?.code || "").trim(),
      amount: BigInt(toInt(r?.amount || 0)),
      description: r?.description == null ? null : String(r.description),
    }))
    .filter((r) => r.code);

  if (!data.length) return json({ ok: true });

  await prisma.budgetEstimate.createMany({ data });
  return json({ ok: true });
}

export async function PATCH(req) {
  const body = await req.json().catch(() => ({}));
  const kind = String(body?.kind || "").trim();
  const projectId = body?.project_id == null ? null : toBigIntSafe(body.project_id);

  if (!ALLOWED.has(kind)) return json({ error: "invalid_kind" }, { status: 400 });
  if (kind === "projects" && !projectId)
    return json({ error: "project_id_required" }, { status: 400 });

  const rows = Array.isArray(body?.rows)
    ? body.rows
    : body?.code
      ? [{ code: body.code, amount: body.amount, description: body.description }]
      : [];

  const data = rows
    .map((r) => ({
      kind,
      projectId: kind === "projects" ? projectId : null,
      code: String(r?.code || "").trim(),
      amount: BigInt(toInt(r?.amount || 0)),
      description: r?.description == null ? null : String(r.description),
    }))
    .filter((r) => r.code);

  if (!data.length) return json({ ok: true });

  await prisma.budgetEstimate.createMany({ data });
  return json({ ok: true });
}

export async function DELETE(req) {
  const body = await req.json().catch(() => ({}));
  const kind = String(body?.kind || "").trim();
  const projectId = body?.project_id == null ? null : toBigIntSafe(body.project_id);
  const codes = Array.isArray(body?.codes) ? body.codes : [];

  if (!ALLOWED.has(kind)) return json({ error: "invalid_kind" }, { status: 400 });
  if (kind === "projects" && !projectId)
    return json({ error: "project_id_required" }, { status: 400 });

  const data = (codes || [])
    .map((c) => String(c || "").trim())
    .filter(Boolean)
    .map((code) => ({
      kind,
      projectId: kind === "projects" ? projectId : null,
      code,
      amount: BigInt(0),
      description: null,
    }));

  if (!data.length) return json({ ok: true });

  await prisma.budgetEstimate.createMany({ data });
  return json({ ok: true });
}
