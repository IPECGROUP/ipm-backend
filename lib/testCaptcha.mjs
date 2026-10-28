// The Host header must be set by the trusted ingress; forwarded headers and
// client-provided body fields are deliberately never used for key selection.
import { createHash } from "node:crypto";

const usedChallenges = new Map();
const REUSE_WINDOW_MS = 10 * 60 * 1000;
const MAX_TRACKED_CHALLENGES = 10000;

export async function verifyTestCaptcha(host, token, { env = process.env, verifyFetch = fetch, challengeCache = usedChallenges } = {}) {
  const match = typeof host === "string" && /^(ips\.ipecgroup\.net|ips\.ipec\.com)(?::[0-9]{1,5})?$/i.exec(host);
  if (!match) return { ok: false, error: "captcha_unavailable", status: 503 };
  const internal = match[1].toLowerCase() === "ips.ipec.com";
  const siteKey = internal ? env.ARCAPTCHA_SITE_KEY_INTERNAL : env.ARCAPTCHA_SITE_KEY;
  const secretKey = internal ? env.ARCAPTCHA_SECRET_KEY_INTERNAL : env.ARCAPTCHA_SECRET_KEY;
  if (typeof siteKey !== "string" || !siteKey.trim() || typeof secretKey !== "string" || !secretKey.trim())
    return { ok: false, error: "captcha_unavailable", status: 503 };
  if (typeof token !== "string" || !token.trim() || token.length > 4096)
    return { ok: false, error: "captcha_invalid", status: 400 };

  const now = Date.now();
  for (const [key, expiresAt] of challengeCache) {
    if (expiresAt <= now) challengeCache.delete(key);
  }
  const challengeKey = createHash("sha256").update(token).digest("hex");
  if (challengeCache.has(challengeKey))
    return { ok: false, error: "captcha_invalid", status: 400 };
  if (challengeCache.size >= MAX_TRACKED_CHALLENGES)
    return { ok: false, error: "captcha_unavailable", status: 503 };
  // Reserve before the network request so concurrent submissions cannot both pass.
  challengeCache.set(challengeKey, now + REUSE_WINDOW_MS);
  try {
    const response = await verifyFetch("https://api.arcaptcha.ir/arcaptcha/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site_key: siteKey, secret_key: secretKey, challenge_id: token }),
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!response.ok) {
      challengeCache.delete(challengeKey);
      return { ok: false, error: "captcha_unavailable", status: 503 };
    }
    const result = await response.json();
    if (result.success !== true) {
      challengeCache.delete(challengeKey);
      return { ok: false, error: "captcha_invalid", status: 400 };
    }
    return { ok: true };
  } catch {
    challengeCache.delete(challengeKey);
    return { ok: false, error: "captcha_unavailable", status: 503 };
  }
}
