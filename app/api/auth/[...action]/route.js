export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "../../../../lib/prisma";
import { cookies } from "next/headers";
import crypto from "crypto";
import bcrypt from "bcryptjs";

const COOKIE_NAME = "ipm_session";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function pickAction(params) {
  const a = params?.action;
  return Array.isArray(a) ? (a[0] || "") : (a || "");
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

function isHttpsRequest(request) {
  const xfProto = (request.headers.get("x-forwarded-proto") || "").toLowerCase();
  if (xfProto.includes("https")) return true;
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

async function handleLogin(request) {
  const body = await readBody(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "").trim();

  if (!username || !password) return json({ error: "username_password_required" }, 400);

  const user = await prisma.user.findFirst({
    where: { OR: [{ username }, { email: username }] },
  });

  if (!user) return json({ error: "invalid_credentials" }, 401);

  const stored = user.passwordHash || user.password || "";
  if (!stored) return json({ error: "user_has_no_password" }, 400);

  let ok = false;
  try {
    if (looksLikeBcryptHash(stored)) ok = await bcrypt.compare(password, stored);
    else ok = password === stored; // برای کاربرهایی که پسورد خام دارند
  } catch {
    ok = false;
  }

  if (!ok) return json({ error: "invalid_credentials" }, 401);

  const token = crypto.randomBytes(32).toString("hex");

  // ✅ Session مدل شما token ندارد، پس token را در id ذخیره می‌کنیم
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
    secure: isHttpsRequest(request), // روی https true، روی تست‌های http (curl localhost) false
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
    const action = pickAction(params);
    if (action === "me") return await handleMe(request);
    return json({ error: "not_found" }, 404);
  } catch (e) {
    console.error("auth_get_error", e);
    return json({ error: "internal_error" }, 500);
  }
}

export async function POST(request, { params }) {
  try {
    const action = pickAction(params);
    if (action === "login") return await handleLogin(request);
    if (action === "logout") return await handleLogout(request);
    return json({ error: "not_found" }, 404);
  } catch (e) {
    console.error("auth_post_error", e);
    return json({ error: "internal_error" }, 500);
  }
}
