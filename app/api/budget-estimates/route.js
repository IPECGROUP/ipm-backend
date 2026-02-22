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
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(init?.headers || {}),
    },
  });

const isProd = process.env.NODE_ENV === "production";

const toBigIntSafe = (v) => {
  try {
    if (v === null || v === undefined || v === "") return null;
    return BigInt(String(v));
  } catch {
    return null;
  }
};

const toIntSafe = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
};

const toInt0 = (v) => {
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

const prismaDebug = (e) => {
  if (isProd) return { message: "server_error" };
  return {
    message: e?.message || "server_error",
    name: e?.name,
    code: e?.code,
    meta: e?.meta,
    stack: e?.stack,
  };
};

// این تابع میاد عملیات DB رو اول با BigInt تست می‌کنه،
// اگر Prisma گفت Int می‌خواد، دوباره با Number انجام میده (و برعکس)
async function tryWithIdModes(fn) {
  let e1 = null;
  try {
    return await fn("bigint");
  } catch (e) {
    e1 = e;
  }
  try {
    return await fn("int");
  } catch (e2) {
    // خطای اصلی رو برگردون تا تشخیص دقیق‌تر باشه
    throw e1 || e2;
  }
}

function coerceId(mode, v) {
  if (mode === "bigint") return toBigIntSafe(v);
  return toIntSafe(v);
}

function coerceAmount(mode, v) {
  if (mode === "bigint") return BigInt(toInt0(v));
  return toInt0(v);
}

async function buildItems({ kind, projectIdRaw }) {
  return await tryWithIdModes(async (mode) => {
    const projectId = kind === "projects" ? coerceId(mode, projectIdRaw) : null;

    let baseCode = "";
    if (kind === "projects") {
      if (projectId == null) return [];
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
      const amount = Number(hit?.last_amount ?? 0);
      const desc = String(hit?.last_desc ?? "").trim();
      // If center row no longer exists and latest estimate is a delete marker, hide it.
      if (amount === 0 && !desc) continue;
      items.push({
        code,
        center_desc: "",
        last_desc: hit?.last_desc ?? "",
        last_amount: amount,
      });
    }

    items.sort((a, b) =>
      String(a.code || "").localeCompare(String(b.code || ""), "fa", {
        numeric: true,
        sensitivity: "base",
      }),
    );

    return items;
  });
}

async function buildHistory({ kind, projectIdRaw }) {
  return await tryWithIdModes(async (mode) => {
    const projectId = kind === "projects" ? coerceId(mode, projectIdRaw) : null;
    if (kind === "projects" && projectId == null) return {};

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
  });
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const kind = String(searchParams.get("kind") || "").trim();
    const projectIdRaw = searchParams.get("project_id");

    const historyMode =
      searchParams.get("history") === "1" ||
      searchParams.get("history") === "true" ||
      searchParams.get("mode") === "history";

    if (!ALLOWED.has(kind)) return json({ error: "invalid_kind" }, { status: 400 });

    if (kind === "projects" && (projectIdRaw == null || projectIdRaw === "")) {
      return historyMode ? json({ history: {} }) : json({ items: [] });
    }

    if (historyMode) {
      const history = await buildHistory({ kind, projectIdRaw });
      return json({ history });
    }

    const items = await buildItems({ kind, projectIdRaw });
    return json({ items });
  } catch (e) {
    return json({ error: "internal_error", ...prismaDebug(e) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const kind = String(body?.kind || "").trim();
    const projectIdRaw = body?.project_id;

    if (!ALLOWED.has(kind)) return json({ error: "invalid_kind" }, { status: 400 });
    if (kind === "projects" && (projectIdRaw == null || projectIdRaw === ""))
      return json({ error: "project_id_required" }, { status: 400 });

    const rows = Array.isArray(body?.rows) ? body.rows : [];
    if (!rows.length) return json({ ok: true });

    await tryWithIdModes(async (mode) => {
      const projectId = kind === "projects" ? coerceId(mode, projectIdRaw) : null;
      if (kind === "projects" && projectId == null) throw new Error("project_id_invalid");

      const data = rows
        .map((r) => ({
          kind,
          projectId: kind === "projects" ? projectId : null,
          code: String(r?.code || "").trim(),
          amount: coerceAmount(mode, r?.amount || 0),
          description: r?.description == null ? null : String(r.description),
        }))
        .filter((r) => r.code);

      if (!data.length) return true;

      await prisma.budgetEstimate.createMany({ data });
      return true;
    });

    return json({ ok: true });
  } catch (e) {
    return json({ error: "internal_error", ...prismaDebug(e) }, { status: 500 });
  }
}

export async function PATCH(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const kind = String(body?.kind || "").trim();
    const projectIdRaw = body?.project_id;

    if (!ALLOWED.has(kind)) return json({ error: "invalid_kind" }, { status: 400 });
    if (kind === "projects" && (projectIdRaw == null || projectIdRaw === ""))
      return json({ error: "project_id_required" }, { status: 400 });

    const rows = Array.isArray(body?.rows)
      ? body.rows
      : body?.code
        ? [{ code: body.code, amount: body.amount, description: body.description }]
        : [];

    if (!rows.length) return json({ ok: true });

    await tryWithIdModes(async (mode) => {
      const projectId = kind === "projects" ? coerceId(mode, projectIdRaw) : null;
      if (kind === "projects" && projectId == null) throw new Error("project_id_invalid");

      const data = rows
        .map((r) => ({
          kind,
          projectId: kind === "projects" ? projectId : null,
          code: String(r?.code || "").trim(),
          amount: coerceAmount(mode, r?.amount || 0),
          description: r?.description == null ? null : String(r.description),
        }))
        .filter((r) => r.code);

      if (!data.length) return true;

      await prisma.budgetEstimate.createMany({ data });
      return true;
    });

    return json({ ok: true });
  } catch (e) {
    return json({ error: "internal_error", ...prismaDebug(e) }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const kind = String(body?.kind || "").trim();
    const projectIdRaw = body?.project_id;
    const codes = Array.isArray(body?.codes) ? body.codes : [];

    if (!ALLOWED.has(kind)) return json({ error: "invalid_kind" }, { status: 400 });
    if (kind === "projects" && (projectIdRaw == null || projectIdRaw === ""))
      return json({ error: "project_id_required" }, { status: 400 });

    const cleanCodes = (codes || []).map((c) => String(c || "").trim()).filter(Boolean);
    if (!cleanCodes.length) return json({ ok: true });

    await tryWithIdModes(async (mode) => {
      const projectId = kind === "projects" ? coerceId(mode, projectIdRaw) : null;
      if (kind === "projects" && projectId == null) throw new Error("project_id_invalid");

      const data = cleanCodes.map((code) => ({
        kind,
        projectId: kind === "projects" ? projectId : null,
        code,
        amount: coerceAmount(mode, 0),
        description: null,
      }));

      await prisma.budgetEstimate.createMany({ data });
      return true;
    });

    return json({ ok: true });
  } catch (e) {
    return json({ error: "internal_error", ...prismaDebug(e) }, { status: 500 });
  }
}
