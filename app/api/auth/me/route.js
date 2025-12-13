import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";

const json = (data, status = 200) => NextResponse.json(data, { status });

export async function GET() {
  const c = cookies();
  const v = c.get("ipm_user")?.value || "";

  if (!v) return json({ error: "unauthorized" }, 401);

  try {
    const user = JSON.parse(decodeURIComponent(v));
    return json({ ok: true, user });
  } catch {
    return json({ error: "bad_session" }, 401);
  }
}
