import { prisma } from "./prisma";
import { NextResponse } from "next/server";

export const SUPER_ADMIN_ACCESS = "system:super-admin";
export const SUPER_ADMIN_USERNAME = "ali";

function readSessionId(request) {
  const direct = request?.cookies?.get?.("ipm_session");
  const value = typeof direct === "string" ? direct : direct?.value;
  if (value) return String(value);
  const cookie = String(request?.headers?.get?.("cookie") || "");
  const match = cookie.match(/(?:^|;\s*)ipm_session=([^;]+)/);
  if (!match?.[1]) return "";
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

export function isSuperAdmin(user) {
  const access = Array.isArray(user?.access) ? user.access.map(String) : [];
  return String(user?.username || "").toLowerCase() === SUPER_ADMIN_USERNAME || access.includes(SUPER_ADMIN_ACCESS);
}

export function isAdmin(user) {
  return isSuperAdmin(user) || String(user?.role || "").toLowerCase() === "admin";
}

export function authError(error = "unauthorized", status = 401) {
  return NextResponse.json({ error }, { status });
}

export async function getAuthenticatedUser(request) {
  const sessionId = readSessionId(request);
  if (!sessionId) return null;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  }).catch(() => null);

  if (!session?.user) return null;
  const now = Date.now();
  if (session.expiresAt && new Date(session.expiresAt).getTime() <= now) return null;
  if (session.user.expiresAt && new Date(session.user.expiresAt).getTime() <= now) return null;
  if (session.user.isActive === false) return null;
  return session.user;
}

export async function requireAdmin(request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return { user: null, denied: authError() };
  if (!isAdmin(user)) return { user, denied: authError("forbidden", 403) };
  return { user, denied: null };
}

export async function requireSuperAdmin(request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return { user: null, denied: authError() };
  if (!isSuperAdmin(user)) return { user, denied: authError("forbidden", 403) };
  return { user, denied: null };
}

export async function requireAliSuperAdmin(request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return { user: null, denied: authError() };
  const access = Array.isArray(user.access) ? user.access.map(String) : [];
  const isAli = String(user.username || "").trim().toLowerCase() === SUPER_ADMIN_USERNAME;
  if (!isAli || !access.includes(SUPER_ADMIN_ACCESS)) {
    return { user, denied: authError("forbidden", 403) };
  }
  return { user, denied: null };
}

export function requestMetadata(request) {
  const forwarded = String(request?.headers?.get?.("x-forwarded-for") || "").split(",")[0].trim();
  return {
    ip: forwarded || String(request?.headers?.get?.("x-real-ip") || "").trim() || null,
    userAgent: String(request?.headers?.get?.("user-agent") || "").slice(0, 500) || null,
    requestId: String(request?.headers?.get?.("x-request-id") || request?.headers?.get?.("x-correlation-id") || "").slice(0, 100) || null,
  };
}
