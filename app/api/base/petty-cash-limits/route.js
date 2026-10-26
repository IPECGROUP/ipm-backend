import { prisma } from "../../../../lib/prisma";
import { ensurePettyCashLimitTable } from "../../../../lib/pettyCashLimit";
import { getAuthenticatedUser, requireAdmin } from "../../../../lib/security";

export const runtime = "nodejs";

export async function GET(request) {
  if (!await getAuthenticatedUser(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    await ensurePettyCashLimitTable();
    const units = await prisma.unit.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true } });
    const limits = await prisma.$queryRawUnsafe("SELECT unit_id AS \"unitId\", limit_amount::text AS amount FROM petty_cash_unit_limits");
    const amounts = new Map(limits.map((row) => [row.unitId, row.amount]));
    return Response.json({ items: units.map((unit) => ({ ...unit, amount: amounts.get(unit.id) ?? null })) });
  } catch (error) {
    console.error("petty_cash_limits_get_failed", error);
    return Response.json({ error: "petty_cash_limits_get_failed" }, { status: 500 });
  }
}

export async function PUT(request) {
  const auth = await requireAdmin(request);
  if (auth.denied) return auth.denied;
  const body = await request.json().catch(() => ({}));
  const unitId = Number(body.unitId);
  const rawAmount = body.amount === null ? "" : String(body.amount ?? "").trim();
  if (!Number.isSafeInteger(unitId) || unitId <= 0 || (rawAmount && !/^[1-9]\d*$/.test(rawAmount))) {
    return Response.json({ error: "invalid_petty_cash_limit" }, { status: 400 });
  }
  if (rawAmount && BigInt(rawAmount) > 9223372036854775807n) return Response.json({ error: "invalid_petty_cash_limit" }, { status: 400 });
  try {
    await ensurePettyCashLimitTable();
    if (!await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true } })) return Response.json({ error: "unit_not_found" }, { status: 404 });
    if (rawAmount) await prisma.$executeRawUnsafe(`
      INSERT INTO petty_cash_unit_limits (unit_id, limit_amount) VALUES ($1, $2::bigint)
      ON CONFLICT (unit_id) DO UPDATE SET limit_amount=EXCLUDED.limit_amount, updated_at=CURRENT_TIMESTAMP
    `, unitId, rawAmount);
    else await prisma.$executeRawUnsafe("DELETE FROM petty_cash_unit_limits WHERE unit_id=$1", unitId);
    return Response.json({ item: { unitId, amount: rawAmount || null } });
  } catch (error) {
    console.error("petty_cash_limits_put_failed", error);
    return Response.json({ error: "petty_cash_limits_put_failed" }, { status: 500 });
  }
}
