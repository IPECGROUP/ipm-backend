const LIQUIDITY_LOCK_NAMESPACE = 482761;

export async function lockProjectLiquidity(transaction, projectId) {
  const id = Number(projectId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("invalid_project_id");
  await transaction.$queryRawUnsafe(
    "SELECT pg_advisory_xact_lock($1::integer, $2::integer)::text AS locked",
    LIQUIDITY_LOCK_NAMESPACE,
    id,
  );
}

export async function lockProjectLiquidities(transaction, projectIds) {
  const ids = [...new Set(projectIds.map(Number))].sort((a, b) => a - b);
  for (const id of ids) await lockProjectLiquidity(transaction, id);
}
