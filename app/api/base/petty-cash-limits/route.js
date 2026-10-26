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
  const changes = Array.isArray(body.items) ? body.items.map((item) => ({
    unitId: Number(item?.unitId),
    amount: item?.amount === null ? "" : String(item?.amount ?? "").trim(),
  })) : [];
  if (!changes.length || changes.length > 1000 || new Set(changes.map((item) => item.unitId)).size !== changes.length || changes.some(({ unitId, amount }) =>
    !Number.isSafeInteger(unitId) || unitId <= 0 || (amount && (!/^[1-9]\d*$/.test(amount) || amount.length > 19 || BigInt(amount) > 9223372036854775807n)))) {
    return Response.json({ error: "invalid_petty_cash_limit" }, { status: 400 });
  }
  try {
    await ensurePettyCashLimitTable();
    const ids = changes.map((item) => item.unitId);
    const units = await prisma.unit.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (units.length !== ids.length) return Response.json({ error: "unit_not_found" }, { status: 404 });
    await prisma.$transaction(async (tx) => {
      for (const { unitId, amount } of changes) {
        if (amount) await tx.$executeRawUnsafe(`
          INSERT INTO petty_cash_unit_limits (unit_id, limit_amount) VALUES ($1, $2::bigint)
          ON CONFLICT (unit_id) DO UPDATE SET limit_amount=EXCLUDED.limit_amount, updated_at=CURRENT_TIMESTAMP
        `, unitId, amount);
        else await tx.$executeRawUnsafe("DELETE FROM petty_cash_unit_limits WHERE unit_id=$1", unitId);
      }
    });
    return Response.json({ items: changes.map(({ unitId, amount }) => ({ unitId, amount: amount || null })) });
  } catch (error) {
    console.error("petty_cash_limits_put_failed", error);
    return Response.json({ error: "petty_cash_limits_put_failed" }, { status: 500 });
  }
}
