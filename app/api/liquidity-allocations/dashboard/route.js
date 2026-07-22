import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

function json(data, status = 200) { return Response.json(data, { status }); }

async function getUserId(request) {
  const value = request.headers.get("x-user-id");
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

async function isAdmin(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, email: true, role: true } });
  return user?.role === "admin" || String(user?.username || "").toLowerCase() === "marandi" || String(user?.email || "").toLowerCase() === "marandi@ipecgroup.net";
}

export async function DELETE(request) {
  const userId = await getUserId(request);
  if (!userId) return json({ error: "unauthorized" }, 401);
  if (!(await isAdmin(userId))) return json({ error: "forbidden" }, 403);
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS financial_dashboard_resets (
        id SERIAL PRIMARY KEY,
        reset_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reset_by INTEGER
      )
    `);
    await prisma.$executeRawUnsafe("INSERT INTO financial_dashboard_resets (reset_by) VALUES ($1)", userId);
    return json({ ok: true });
  } catch (error) {
    return json({ error: "internal_error", message: String(error?.message || "internal_error") }, 500);
  }
}
