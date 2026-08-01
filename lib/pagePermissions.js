import { prisma } from "./prisma";

// This mapping mirrors the page order used by AccessManagementPage.
const PAGE_INDEX = {
  "داشبورد": 0,
  "مدیریت اسناد": 1,
  "قراردادها": 2,
  "روزنگار پروژه": 4,
  "ساختار شکست هزینه‌ها": 5,
  "تعهدات و مصارف مالی": 6,
  "کاربرگ مالی": 7,
  "درخواست پرداخت": 9,
  "تخصیص نقدینگی": 10,
  "پیش‌بینی جریان نقدی": 11,
  "درخواست تأمین": 13,
};

function isAdmin(user) {
  return String(user?.role || "").toLowerCase() === "admin";
}

export async function hasPagePermission(request, page, permission) {
  const token = request.cookies.get("ipm_session")?.value;
  if (!token) return false;

  const session = await prisma.session.findUnique({ where: { id: token }, include: { user: true } });
  const user = session?.user;
  if (!user || (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now())) return false;
  if (isAdmin(user)) return true;

  const pageIndex = PAGE_INDEX[page];
  if (pageIndex === undefined) return false;
  const permissions = Array.isArray(user.access) ? user.access.map(String) : [];
  return permissions.includes(`page-access:${pageIndex}:همه`) || permissions.includes(`page-access:${pageIndex}:${permission}`);
}
