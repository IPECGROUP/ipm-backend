import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const mockModules = new Map([
  ["../../../../lib/prisma", "export const prisma = globalThis.__loginTest.prisma;"],
  ["next/headers", "export const cookies = async () => globalThis.__loginTest.jar;"],
  ["../../../../lib/auditLog", "export const writeAuditLog = async (entry) => { globalThis.__loginTest.audit.push(entry); };"],
  ["../../../../lib/sessionActivityLog", "export const logSessionStart = async () => {}; export const logSessionEnd = async () => {};"],
  ["../../../../lib/security", `
    export const SESSION_IDLE_TIMEOUT_SECONDS = 1800;
    export const SESSION_ABSOLUTE_TIMEOUT_SECONDS = 28800;
    export const requestMetadata = (request) => ({ ip: request.headers.get("x-test-ip"), userAgent: "test" });
    export const cleanupExpiredSessions = async () => {};
    export const isSessionExpired = () => false;
    export const sessionExpiresAt = () => null;
    export const touchSession = async (session) => session;
  `],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const source = mockModules.get(specifier);
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const state = {
  prisma: {
    user: { findFirst: async () => state.user },
    session: { create: async (value) => { state.sessions.push(value); return value; } },
  },
  jar: { set: (...args) => state.cookies.push(args) },
  audit: [],
  cookies: [],
  sessions: [],
  user: null,
};
globalThis.__loginTest = state;

const { POST } = await import("../app/api/auth/[...action]/route.js");
const originalFetch = globalThis.fetch;
const originalEnv = {
  ARCAPTCHA_SITE_KEY: process.env.ARCAPTCHA_SITE_KEY,
  ARCAPTCHA_SECRET_KEY: process.env.ARCAPTCHA_SECRET_KEY,
  ARCAPTCHA_SITE_KEY_INTERNAL: process.env.ARCAPTCHA_SITE_KEY_INTERNAL,
  ARCAPTCHA_SECRET_KEY_INTERNAL: process.env.ARCAPTCHA_SECRET_KEY_INTERNAL,
};
Object.assign(process.env, {
  ARCAPTCHA_SITE_KEY: "external-site",
  ARCAPTCHA_SECRET_KEY: "external-secret",
  ARCAPTCHA_SITE_KEY_INTERNAL: "internal-site",
  ARCAPTCHA_SECRET_KEY_INTERNAL: "internal-secret",
});

let sequence = 0;
function reset() {
  state.audit.length = 0;
  state.cookies.length = 0;
  state.sessions.length = 0;
  state.user = { id: 42, username: `user-${++sequence}`, password: "correct", isActive: true, role: "user", access: [] };
}

async function login({ token = `token-${++sequence}`, password = "correct", username = state.user.username, ip = `192.0.2.${++sequence}`, host = "ips.ipec.com", action = "login" } = {}) {
  const request = new Request(`https://${host}/api/auth/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Host: host, "x-test-ip": ip },
    body: JSON.stringify({ username, password, captchaToken: token }),
  });
  const response = await POST(request, { params: { action: [action] } });
  return { status: response.status, body: await response.json() };
}

test("valid captcha allows one session and preserves secure cookie and audit", async () => {
  reset();
  globalThis.fetch = async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), {
      site_key: "internal-site", secret_key: "internal-secret", challenge_id: "success-token",
    });
    return { ok: true, json: async () => ({ success: true }) };
  };
  const result = await login({ token: "success-token" });
  assert.equal(result.status, 200);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.cookies.length, 1);
  assert.equal(state.cookies[0][2].httpOnly, true);
  assert.equal(state.cookies[0][2].sameSite, "lax");
  assert.equal(state.audit.at(-1).action, "login_success");
});

test("missing, rejected, and unavailable captcha never create a session", async () => {
  for (const [token, response, expectedStatus] of [
    ["", null, 400],
    ["rejected-token", { ok: true, json: async () => ({ success: false }) }, 400],
    ["unavailable-token", { ok: false }, 503],
  ]) {
    reset();
    globalThis.fetch = async () => response;
    const result = await login({ token });
    assert.equal(result.status, expectedStatus);
    assert.equal(state.sessions.length, 0);
    assert.equal(state.cookies.length, 0);
    assert.equal(state.audit.some((entry) => entry.action === "login_success"), false);
  }
});

test("reused captcha and simultaneous API requests cannot create a second session", async () => {
  reset();
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true }) });
  const first = await login({ token: "replay-token" });
  const second = await login({ token: "replay-token" });
  assert.equal(first.status, 200);
  assert.equal(second.status, 400);
  assert.equal(state.sessions.length, 1);

  reset();
  let release;
  globalThis.fetch = () => new Promise((resolve) => { release = () => resolve({ ok: true, json: async () => ({ success: true }) }); });
  const pending = login({ token: "parallel-token" });
  await new Promise((resolve) => setImmediate(resolve));
  const duplicate = await login({ token: "parallel-token" });
  release();
  const accepted = await pending;
  assert.equal(accepted.status, 200);
  assert.equal(duplicate.status, 400);
  assert.equal(state.sessions.length, 1);
});

test("IP limit and account lock still block login", async () => {
  reset();
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true }) });
  for (let index = 0; index < 5; index++) {
    const result = await login({ token: `lock-${index}`, password: "wrong" });
    assert.equal(result.status, index === 4 ? 429 : 401);
  }
  assert.equal((await login({ token: "locked-valid" })).status, 429);
  assert.equal(state.sessions.length, 0);

  reset();
  const fixedIp = `198.51.100.${++sequence}`;
  for (let index = 0; index < 10; index++) {
    await login({ token: `rate-${index}`, password: "wrong", ip: fixedIp });
  }
  const limited = await login({ token: "rate-valid", ip: fixedIp });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, "too_many_login_attempts");
  assert.equal(state.sessions.length, 0);
});

test("independent test-login remains available without issuing a session", async () => {
  reset();
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true }) });
  const result = await login({ action: "test-login", username: "test", password: "test", token: "test-only-token" });
  assert.equal(result.status, 200);
  assert.equal(state.sessions.length, 0);
});

test.after(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  delete globalThis.__loginTest;
});
