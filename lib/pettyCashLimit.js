import { prisma } from "./prisma";

let ready;

export async function ensurePettyCashLimitTable() {
  if (!ready) ready = prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS petty_cash_unit_limits (
      unit_id INTEGER PRIMARY KEY REFERENCES "Unit"(id) ON DELETE CASCADE,
      limit_amount BIGINT NOT NULL CHECK (limit_amount > 0),
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).catch((error) => { ready = null; throw error; });
  return ready;
}

export async function readPettyCashBalance(userId) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(SUM(GREATEST(0,COALESCE(t.charged_amount,0)-COALESCE((SELECT SUM(e.amount) FROM tenkhah_settlements s JOIN tenkhah_settlement_entries e ON e.settlement_id=s.id WHERE s.tenkhah_request_id=t.id),0))),0)::text AS "unregisteredBalance",
           COALESCE(SUM(GREATEST(0,COALESCE(t.charged_amount,0)-COALESCE((SELECT SUM(e.amount) FROM tenkhah_settlements s JOIN tenkhah_settlement_entries e ON e.settlement_id=s.id WHERE s.tenkhah_request_id=t.id AND s.status='completed'),0))),0)::text AS "unsettledBalance",
           COALESCE(SUM(COALESCE(t.charged_amount,0)),0)::text AS "receivedAmount"
    FROM tenkhah_requests t
    WHERE COALESCE(t.beneficiary_user_id,t.created_by_id)=$1 AND t.status='charged'
  `, userId);
  const balances = rows[0] || { unregisteredBalance: "0", unsettledBalance: "0", receivedAmount: "0" };
  try {
    const expenses = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(SUM(amount),0)::text AS "registeredAmount",
             COALESCE(SUM(amount) FILTER (WHERE stage='completed' AND project_manager_status='approved'),0)::text AS "approvedAmount"
      FROM petty_cash_expenses WHERE created_by_id=$1 AND stage<>'draft'
    `, userId);
    const expense = expenses[0] || {};
    const remaining = (value, deducted) => {
      const result = BigInt(value || "0") - BigInt(deducted || "0");
      return (result > 0n ? result : 0n).toString();
    };
    balances.unregisteredBalance = remaining(balances.unregisteredBalance, expense.registeredAmount);
    balances.unsettledBalance = remaining(balances.unsettledBalance, expense.approvedAmount);
  } catch {
    // Older installations may not have the expense subsystem yet.
  }
  return balances;
}

export async function pettyCashLimitForUser(userId) {
  await ensurePettyCashLimitTable();
  // Membership can be assigned directly or inherited through a unit role.
  // For a person in several units, the lowest configured limit applies.
  const rows = await prisma.$queryRawUnsafe(`
    SELECT MIN(l.limit_amount)::text AS amount
    FROM petty_cash_unit_limits l
    WHERE l.unit_id IN (
      SELECT uu."unitId" FROM "UserUnit" uu WHERE uu."userId"=$1
      UNION
      SELECT ur."unitId" FROM "UnitRoleMap" ur
      JOIN "UserRoleMap" rm ON rm."roleId"=ur."roleId"
      WHERE rm."userId"=$1
    )
  `, userId);
  return rows[0]?.amount ?? null;
}

export async function pettyCashLimitStatus(userId) {
  const [limitAmount, balances] = await Promise.all([pettyCashLimitForUser(userId), readPettyCashBalance(userId)]);
  return {
    limitAmount,
    unsettledBalance: balances.unsettledBalance,
    blocked: limitAmount !== null && BigInt(balances.unsettledBalance) >= BigInt(limitAmount),
  };
}
