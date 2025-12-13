import { NextResponse } from "next/server";

export const runtime = "nodejs";

const json = (data, status = 200) => NextResponse.json(data, { status });

export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch {}

  const username = String(body?.username || body?.user || "").trim();
  const password = String(body?.password || "").trim();

  if (username !== "marandi" || password !== "1234") {
    return json({ error: "invalid_credentials" }, 401);
  }

  const user = {
    username: "marandi",
    name: "marandi",
    role: "admin",
    access_labels: ["all"],
  };

  const res = json({ ok: true, user });

  res.cookies.set("ipm_user", encodeURIComponent(JSON.stringify(user)), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  return res;
}
