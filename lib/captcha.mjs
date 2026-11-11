import { createChallenge, verifySolution } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import { createClient } from "redis";

const lifetime = 300;
let clientPromise;
function secretForHost(host, env = process.env) {
  const name = String(host || "").toLowerCase().replace(/:\d+$/, "");
  if (name === "ips.ipecgroup.net") return env.ALTCHA_HMAC_SECRET;
  if (name === "ips.ipec.com") return env.ALTCHA_HMAC_SECRET_INTERNAL;
  if (env.NODE_ENV !== "production" && (name === "localhost" || name === "127.0.0.1")) return env.ALTCHA_HMAC_SECRET;
  return undefined;
}
async function store() {
  if (!process.env.CAPTCHA_REDIS_URL) throw new Error("CAPTCHA store unavailable");
  if (!clientPromise) {
    const client = createClient({ url: process.env.CAPTCHA_REDIS_URL, socket: { connectTimeout: 1000, reconnectStrategy: false } });
    client.on("error", () => {});
    clientPromise = client.connect().then(() => client).catch((err) => { clientPromise = undefined; throw err; });
  }
  return clientPromise;
}
export async function makeChallenge(host) {
  const secret = secretForHost(host);
  if (!secret || secret.length < 32) throw new Error("CAPTCHA unavailable");
  return createChallenge({ algorithm: "PBKDF2/SHA-256", cost: 1000, deriveKey, expiresAt: Math.floor(Date.now() / 1000) + lifetime, hmacSignatureSecret: secret });
}
export async function limitChallenge(ip) {
  const redis = await store();
  const key = `altcha:rate:${ip}`;
  const count = await redis.eval('local n=redis.call("INCR",KEYS[1]); if n==1 then redis.call("EXPIRE",KEYS[1],60) end; return n', { keys: [key], arguments: [] });
  return count <= 60;
}
export async function verifyCaptcha(host, token, { env = process.env, consume } = {}) {
  const secret = secretForHost(host, env);
  if (!secret || secret.length < 32) return { ok: false, error: "captcha_unavailable", status: 503 };
  if (typeof token !== "string" || !token || token.length > 8192) return { ok: false, error: "captcha_invalid", status: 400 };
  let payload;
  try { payload = JSON.parse(Buffer.from(token, "base64").toString("utf8")); }
  catch { return { ok: false, error: "captcha_invalid", status: 400 }; }
  try {
    const { challenge, solution } = payload;
    const p = challenge?.parameters;
    if (!p || p.algorithm !== "PBKDF2/SHA-256" || p.cost !== 1000 || !Number.isInteger(p.expiresAt) || p.expiresAt <= Date.now() / 1000 || p.expiresAt > Date.now() / 1000 + lifetime + 5 || typeof challenge.signature !== "string" || !solution) return { ok: false, error: "captcha_invalid", status: 400 };
    const result = await verifySolution({ challenge, solution, deriveKey, hmacSignatureSecret: secret });
    if (!result.verified) return { ok: false, error: "captcha_invalid", status: 400 };
    const ttl = Math.max(1, Math.ceil(p.expiresAt - Date.now() / 1000));
    const accepted = consume ? await consume(challenge.signature, ttl) : await (await store()).set(`altcha:used:${challenge.signature}`, "1", { NX: true, EX: ttl });
    return accepted ? { ok: true } : { ok: false, error: "captcha_invalid", status: 400 };
  } catch { return { ok: false, error: "captcha_unavailable", status: 503 }; }
}
export async function checkLoginCaptcha(host, token) {
  const enforce = process.env.CAPTCHA_ENFORCEMENT_ENABLED === "true";
  if (!enforce) {
    if (token) void verifyCaptcha(host, token).then((result) => {
      if (process.env.NODE_ENV === "test") console.info("CAPTCHA verification:", result.ok ? "valid" : result.error);
    }).catch(() => {});
    return { ok: true };
  }
  return verifyCaptcha(host, token);
}
