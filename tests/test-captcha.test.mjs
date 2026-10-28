import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyTestCaptcha } from "../lib/testCaptcha.mjs";

const env = { ARCAPTCHA_SITE_KEY: "external-site", ARCAPTCHA_SECRET_KEY: "external-secret", ARCAPTCHA_SITE_KEY_INTERNAL: "internal-site", ARCAPTCHA_SECRET_KEY_INTERNAL: "internal-secret" };

test("each allowed host uses its own pair", async () => {
  for (const [host, prefix] of [["ips.ipecgroup.net", "external"], ["ips.ipec.com:443", "internal"]]) {
    let calls = 0;
    const result = await verifyTestCaptcha(host, `${prefix}-valid`, { env, verifyFetch: async (url, options) => {
      calls++;
      assert.deepEqual(JSON.parse(options.body), { site_key: `${prefix}-site`, secret_key: `${prefix}-secret`, challenge_id: `${prefix}-valid` });
      return { ok: true, json: async () => ({ success: true }) };
    } });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 1);
  }
});

test("unknown, malformed and missing hosts cannot call verification", async () => {
  for (const host of ["evil.example", "ips.ipec.com.evil.example", "ips.ipec.com, ips.ipecgroup.net", "", null]) {
    const result = await verifyTestCaptcha(host, "valid", { env, verifyFetch: () => { throw new Error("must not call"); } });
    assert.equal(result.error, "captcha_unavailable");
  }
});

test("missing keys and invalid tokens fail closed without a request", async () => {
  for (const [host, token, vars, error] of [["ips.ipec.com", "valid", { ...env, ARCAPTCHA_SECRET_KEY_INTERNAL: "" }, "captcha_unavailable"], ["ips.ipecgroup.net", "", env, "captcha_invalid"], ["ips.ipec.com", "x".repeat(4097), env, "captcha_invalid"]]) {
    let called = false;
    const result = await verifyTestCaptcha(host, token, { env: vars, verifyFetch: () => { called = true; } });
    assert.equal(result.error, error);
    assert.equal(called, false);
  }
});

test("verification failure, malformed response and network failure never pass", async () => {
  for (const verifyFetch of [async () => ({ ok: true, json: async () => ({ success: false }) }), async () => ({ ok: true, json: async () => ({ success: "true" }) }), async () => ({ ok: false }), async () => { throw new Error("offline"); }]) {
    const result = await verifyTestCaptcha("ips.ipec.com", "invalid", { env, verifyFetch });
    assert.equal(result.ok, false);
  }
});

test("a verified challenge cannot be reused", async () => {
  const challengeCache = new Map();
  let calls = 0;
  const verifyFetch = async () => {
    calls++;
    return { ok: true, json: async () => ({ success: true }) };
  };
  assert.deepEqual(await verifyTestCaptcha("ips.ipec.com", "once", { env, verifyFetch, challengeCache }), { ok: true });
  assert.equal((await verifyTestCaptcha("ips.ipec.com", "once", { env, verifyFetch, challengeCache })).error, "captcha_invalid");
  assert.equal(calls, 1);
});

test("concurrent submissions reserve the challenge before verification", async () => {
  const challengeCache = new Map();
  let finish;
  let calls = 0;
  const verifyFetch = () => {
    calls++;
    return new Promise((resolve) => { finish = () => resolve({ ok: true, json: async () => ({ success: true }) }); });
  };
  const first = verifyTestCaptcha("ips.ipec.com", "concurrent", { env, verifyFetch, challengeCache });
  const second = await verifyTestCaptcha("ips.ipec.com", "concurrent", { env, verifyFetch, challengeCache });
  assert.equal(second.error, "captcha_invalid");
  finish();
  assert.deepEqual(await first, { ok: true });
  assert.equal(calls, 1);
});
