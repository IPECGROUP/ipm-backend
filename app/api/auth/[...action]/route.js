export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "../../../../lib/prisma";
import { cookies } from "next/headers";
import crypto from "crypto";
import bcrypt from "bcryptjs";

const COOKIE_NAME = "ipm_session";
const SUPER_ADMIN_USERNAME = "ali";
const SUPER_ADMIN_ACCESS = "system:super-admin";
// BCrypt hash for the requested hard-coded password. Keeping the hash rather
// than the password in the source preserves the normal login flow.
const SUPER_ADMIN_PASSWORD_HASH = "$2b$10$YOmcMEL92qyrmbpzdTebHOaDAVjf0bzFtx8sQ/mCsdLFo6w9dTrcW";

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

  if (!user) return json({ error: "invalid_credentials" }, 401);
  if (userIsExpired(user)) return json({ error: "user_expired" }, 403);

  const stored = user.passwordHash || user.password || "";
  if (!stored) return json({ error: "user_has_no_password" }, 400);

  let ok = false;
  try {
    ok = looksLikeBcryptHash(stored) ? await bcrypt.compare(password, stored) : password === stored;
  } catch {
    ok = false;
  }
  if (!ok) return json({ error: "invalid_credentials" }, 401);

  const token = crypto.randomBytes(32).toString("hex");

  // ✅ session token را داخل id ذخیره می‌کنیم (چون مدل شما token ندارد)
  await prisma.session.create({
    data: {
      id: token,
      userId: user.id,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    },
  });

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttpsRequest(request),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return json({ ok: true, user: safeUser(user) });
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
  if (userIsExpired(sess.user)) {
    try { await prisma.session.delete({ where: { id: sess.id } }); } catch {}
    jar.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
    return json({ user: null });
  }

  if (sess.expiresAt && new Date(sess.expiresAt).getTime() < Date.now()) {
    try { await prisma.session.delete({ where: { id: sess.id } }); } catch {}
    jar.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
    return json({ user: null });
  }

  return json({ user: safeUser(sess.user) });
}

async function handleLogout(request) {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value || "";
  if (token) {
    try { await prisma.session.deleteMany({ where: { id: token } }); } catch {}
  }
  jar.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
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
