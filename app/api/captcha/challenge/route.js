import { limitChallenge, makeChallenge } from "../../../../lib/captcha.mjs";

export const dynamic = "force-dynamic";
export async function GET(request) {
  const headers = { "Cache-Control": "no-store, max-age=0" };
  try {
    // The reverse proxy overwrites X-Real-IP with the peer address.
    const ip = request.headers.get("x-real-ip") || "unknown";
    if (!(await limitChallenge(ip))) return Response.json({ error: "captcha_rate_limited" }, { status: 429, headers });
    return Response.json(await makeChallenge(request.headers.get("host")), { headers });
  } catch {
    return Response.json({ error: "captcha_unavailable" }, { status: 503, headers });
  }
}
