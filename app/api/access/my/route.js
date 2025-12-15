// app/api/access/my/route.js
export const runtime = "nodejs";

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

  // بعضی اسکیمه‌ها unique رو روی id دارند، بعضی‌ها روی token
  try {
    return await sessionDelegate.findUnique({ where: { id: sid } });
  } catch {}
  try {
    return await sessionDelegate.findUnique({ where: { token: sid } });
  } catch {}

  return null;
}

async function getUserUnitIds(userId) {
  // محتمل‌ترین نام‌های مدل
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

  // بعضی وقت‌ها select/field اسمش فرق می‌کنه
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

    // admin => همه صفحات و همه تب‌ها
    if (isAdminUser(user)) {
      const pages = {};
      for (const p of KNOWN_PAGES) pages[p] = { permitted: 1, tabs: null };
      return NextResponse.json({
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
      });
    }

    const unitIds = await getUserUnitIds(user.id);

    // اگر واحد ندارد => هیچ دسترسی
    const pages = {};
    for (const p of KNOWN_PAGES) pages[p] = null;

    if (!unitIds.length) {
      return NextResponse.json({
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
      });
    }

    const rules = await getUnitAccessRules(unitIds);

    // گروه بندی rule ها بر اساس page
    const byPage = new Map();
    for (const r of rules || []) {
      const page = String(r.page || "").trim();
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

      // اگر page-level allow (tab=null) داشتیم => همه تب‌ها
      const pageLevelAllow = rs.some((x) => (x.tab == null || x.tab === "") && truthy(x.permitted));
      if (pageLevelAllow) {
        pages[page] = { permitted: 1, tabs: null };
        continue;
      }

      // وگرنه فقط تب‌های مجاز
      const tabs = {};
      for (const x of rs) {
        if (x.tab == null || x.tab === "") continue;
        const t = String(x.tab).trim();
        if (!t) continue;
        if (truthy(x.permitted)) tabs[t] = 1;
      }

      pages[page] = { permitted: 1, tabs };
    }

    return NextResponse.json({
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
    });
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
