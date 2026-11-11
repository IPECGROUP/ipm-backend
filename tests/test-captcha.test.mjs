import { test } from "node:test";
import assert from "node:assert/strict";
import { createChallenge, solveChallenge } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import { verifyCaptcha, checkLoginCaptcha } from "../lib/captcha.mjs";
const secret = "test-secret-".repeat(4);
const env = { NODE_ENV: "test", ALTCHA_HMAC_SECRET: secret };
const used = new Set();
const consume = async (signature) => !used.has(signature) && !!used.add(signature);
async function payload(expiresAt = Math.floor(Date.now()/1000)+300) {
  const challenge = await createChallenge({ algorithm: "PBKDF2/SHA-256", cost: 1000, deriveKey, expiresAt, hmacSignatureSecret: secret });
  const solution = await solveChallenge({ challenge, deriveKey });
  return { challenge, solution };
}
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
test("valid challenge verifies once for concurrent submissions", async () => {
  const data = await payload();
  assert.equal(JSON.stringify(data.challenge).includes(secret), false);
  const results = await Promise.all([1,2].map(() => verifyCaptcha("localhost", encode(data), { env, consume })));
  assert.equal(results.filter((r) => r.ok).length, 1);
});
test("invalid, tampered, expired and wrong-site payloads are rejected", async () => {
  const data = await payload();
  const cases = ["garbage", encode({ ...data, solution: { ...data.solution, derivedKey: "00" } }), encode({ ...data, challenge: { ...data.challenge, parameters: { ...data.challenge.parameters, cost: 1 } } }), encode(await payload(Math.floor(Date.now()/1000)-1))];
  for (const token of cases) assert.equal((await verifyCaptcha("localhost", token, { env, consume })).ok, false);
  assert.equal((await verifyCaptcha("ips.ipec.com", encode(data), { env, consume })).ok, false);
});
test("optional mode accepts absent or invalid CAPTCHA", async () => {
  const original = process.env.CAPTCHA_ENFORCEMENT_ENABLED; process.env.CAPTCHA_ENFORCEMENT_ENABLED = "false";
  try { assert.equal((await checkLoginCaptcha("localhost", "")).ok, true); assert.equal((await checkLoginCaptcha("localhost", "bad")).ok, true); }
  finally { if (original === undefined) delete process.env.CAPTCHA_ENFORCEMENT_ENABLED; else process.env.CAPTCHA_ENFORCEMENT_ENABLED = original; }
});
