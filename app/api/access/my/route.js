// app/api/access/my/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";

const KNOWN_PAGES = [
  "DefineBudgetCentersPage",
  "EstimatesPage",
  "BudgetAllocationPage",
  "ReportsPage",
  "UsersPage",
];

function isAdminUser(u) {
  if (!u) return false;
  const uname = String(u.username || "").toLowerCase().trim();
  const email = String(u.email || "").toLowerCase().trim();
  return (
    uname === "marandi" ||
    email === "marandi@ipecgroup.net" ||
    String(u.role || "").toLowerCase() === "admin"
  );
}

function truthy(v) {
  return v === true || v === 1 || v === "1" || v === "true";
}

function pickDelegate(names) {
  for (const n of names) {
    const d = prisma?.[n];
    if (d && typeof d.findMany === "function") return d;
  }
  return null;
}

async function getSessionByCookie(sid) {
  const sessionDelegate = pickDelegate(["session", "sessions"]);
  if (!sessionDelegate) return null;

  try {
    return await sessionDelegate.findUnique({ where: { id: sid } });
  } catch {}
  try {
    return await sessionDelegate.findUnique({ where: { token: sid } });
  } catch {}

  return null;
}

async function getUserUnitIds(userId) {
  const d =
    pickDelegate([
      "userUnit",
      "userUnits",
      "userUnitMap",
      "userRoleUnitMap",
      "userUnitMembership",
      "userUnitsMap",
    ]) || null;

  if (!d) return [];

  try {
    const rows = await d.findMany({
      where: { userId },
      select: { unitId: true },
    });
    return Array.from(new Set((rows || []).map((r) => r.unitId).filter(Boolean)));
  } catch {}

  try {
    const rows = await d.findMany({ where: { userId } });
    const unitIds = (rows || [])
      .map((r) => r.unitId ?? r.unit_id ?? r.unitID ?? r.unit)
      .filter((x) => x != null)
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x) && x > 0);
    return Array.from(new Set(unitIds));
  } catch {
    return [];
  }
}

async function getUnitAccessRules(unitIds) {
  const d = pickDelegate(["unitAccessRule", "unitAccessRules"]);
  if (!d) return [];
  return await d.findMany({
    where: { unitId: { in: unitIds } },
    orderBy: { id: "asc" },
  });
}

function normalizePage(v) {
  const s = String(v ?? "").trim();
  return s || "";
}

function normalizeTab(rule) {
  let raw;
  if (Object.prototype.hasOwnProperty.call(rule, "tab")) raw = rule.tab;
  else if (Object.prototype.hasOwnProperty.call(rule, "tab_name")) raw = rule.tab_name;
  else if (Object.prototype.hasOwnProperty.call(rule, "tabName")) raw = rule.tabName;
  else if (Object.prototype.hasOwnProperty.call(rule, "tab_key")) raw = rule.tab_key;
  else if (Object.prototype.hasOwnProperty.call(rule, "tabKey")) raw = rule.tabKey;
  else return { tab: "__MISSING__" };

  if (raw === null) return { tab: null };
  if (raw === undefined) return { tab: "__MISSING__" };

  const s = String(raw).trim();
  if (!s) return { tab: null };
  if (s.toLowerCase() === "null") return { tab: null };
  return { tab: s };
}

function dedupeRulesByKey(rules) {
  const keep = new Map(); // key -> bestRow

  for (const r of rules || []) {
    const page = normalizePage(r.page);
    if (!page) continue;

    const { tab } = normalizeTab(r);
    if (tab === "__MISSING__") continue;

    const key = `${r.unitId}::${page}::${tab === null ? "__NULL__" : String(tab)}`;

    const prev = keep.get(key);
    if (!prev) {
      keep.set(key, r);
      continue;
    }

    const prevTime = prev.updatedAt ? new Date(prev.updatedAt).getTime() : 0;
    const curTime = r.updatedAt ? new Date(r.updatedAt).getTime() : 0;

    const curBetter = curTime > prevTime || (curTime === prevTime && (r.id || 0) > (prev.id || 0));
    if (curBetter) keep.set(key, r);
  }

  return Array.from(keep.values());
}

export async function GET(request) {
  try {
    const sid = request.cookies.get("ipm_session")?.value;
    if (!sid) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const session = await getSessionByCookie(sid);
    if (!session) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) {
      return NextResponse.json({ ok: false, error: "session_expired" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    if (isAdminUser(user)) {
      const pages = {};
      for (const p of KNOWN_PAGES) pages[p] = { permitted: 1, tabs: null };
      return NextResponse.json(
        {
          ok: true,
          user: {
            id: user.id,
            username: user.username,
            name: user.name,
            email: user.email,
            role: user.role,
            access: user.access || [],
          },
          unitIds: [],
          pages,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const unitIds = await getUserUnitIds(user.id);

    const pages = {};
    for (const p of KNOWN_PAGES) pages[p] = null;

    if (!unitIds.length) {
      return NextResponse.json(
        {
          ok: true,
          user: {
            id: user.id,
            username: user.username,
            name: user.name,
            email: user.email,
            role: user.role,
            access: user.access || [],
          },
          unitIds,
          pages,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const rulesRaw = await getUnitAccessRules(unitIds);
    const rules = dedupeRulesByKey(rulesRaw);

    const byPage = new Map();
    for (const r of rules || []) {
      const page = normalizePage(r.page);
      if (!page) continue;
      if (!byPage.has(page)) byPage.set(page, []);
      byPage.get(page).push(r);
    }

    for (const page of KNOWN_PAGES) {
      const rs = byPage.get(page) || [];
      if (!rs.length) {
        pages[page] = null;
        continue;
      }

      const pageLevelAllow = rs.some((x) => {
        const { tab } = normalizeTab(x);
        if (tab === "__MISSING__") return false;
        return tab === null && truthy(x.permitted);
      });

      if (pageLevelAllow) {
        pages[page] = { permitted: 1, tabs: null };
        continue;
      }

      const tabs = {};
      for (const x of rs) {
        const { tab } = normalizeTab(x);
        if (tab === "__MISSING__") continue;
        if (tab === null) continue;
        if (truthy(x.permitted)) tabs[String(tab)] = 1;
      }

      if (!Object.keys(tabs).length) {
        pages[page] = null;
        continue;
      }

      pages[page] = { permitted: 1, tabs };
    }

    return NextResponse.json(
      {
        ok: true,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          email: user.email,
          role: user.role,
          access: user.access || [],
        },
        unitIds,
        pages,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("access_my_error", e);
    return NextResponse.json(
      {
        error: "internal_error",
        message: e?.message || "unknown_error",
      },
      { status: 500 }
    );
  }
}
  