import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { readSessionActivityLogs } from "../../../../../lib/sessionActivityLog";

export const dynamic = "force-dynamic";

async function currentUser(request) {
  const sessionId = request.cookies.get("ipm_session")?.value || "";
  if (!sessionId) return null;
  const session = await prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } }).catch(() => null);
  return session?.user || null;
}

export async function GET(request) {
  const user = await currentUser(request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!["marandi", "nouri"].includes(String(user.username || "").toLowerCase())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const rows = await readSessionActivityLogs();
    return NextResponse.json({ items: rows.map((row) => ({ id: row.session_id, name: row.name || row.username, username: row.username, loggedInAt: row.logged_in_at, loggedOutAt: row.logged_out_at })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { console.error("home_user_activity_failed", error); return NextResponse.json({ error: "user_activity_failed" }, { status: 500 }); }
}
