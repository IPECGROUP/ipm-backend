// app/api/access/my/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
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

export async function GET() {
  try {
    const c = cookies();
    const sid = c.get("ipm_session")?.value;
    if (!sid) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const session = await prisma.session.findUnique({ where: { id: sid } });
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

    // ادمین => همه صفحات و همه تب‌ها مجاز
    if (isAdminUser(user)) {
      const pages = {};
      for (const p of KNOWN_PAGES) {
        pages[p] = { permitted: 1, tabs: null };
      }
      return NextResponse.json({
        ok: true,
        user: { id: user.id, username: user.username, role: user.role, email: user.email, name: user.name },
        unitIds: [],
        pages,
      });
    }

    // واحدهای کاربر
    const userUnitModel = prisma.userUnit || prisma.userUnits;
    if (!userUnitModel) {
      return NextResponse.json({ ok: false, error: "user_unit_model_missing" }, { status: 500 });
    }

    const urows = await userUnitModel.findMany({
      where: { userId: user.id },
      select: { unitId: true },
    });
    const unitIds = Array.from(new Set((urows || []).map((x) => x.unitId).filter(Boolean)));

    // اگر کاربر واحد ندارد => هیچ دسترسی
    const pages = {};
    for (const p of KNOWN_PAGES) pages[p] = null;

    if (!unitIds.length) {
      return NextResponse.json({
        ok: true,
        user: { id: user.id, username: user.username, role: user.role, email: user.email, name: user.name },
        unitIds,
        pages,
      });
    }

    // قوانین دسترسی
    const rules = await prisma.unitAccessRule.findMany({
      where: { unitId: { in: unitIds } },
      orderBy: { id: "asc" },
    });

    // گروه‌بندی بر اساس page
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

      // اگر page-level rule داریم (tab == null) و permitted=true => کل صفحه + همه تب‌ها
      const pageLevelAllow = rs.some((x) => (x.tab == null || x.tab === "") && truthy(x.permitted));
      if (pageLevelAllow) {
        pages[page] = { permitted: 1, tabs: null };
        continue;
      }

      // اگر ruleهای تب داریم => فقط همان تب‌های permitted مجاز
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
      user: { id: user.id, username: user.username, role: user.role, email: user.email, name: user.name },
      unitIds,
      pages,
    });
  } catch (e) {
    console.error("access_my_error", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
