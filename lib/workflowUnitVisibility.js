// Members can see work handled by colleagues in their current explicit units.
export async function workflowColleagueIds(prisma, userId) {
  const [direct, appointments] = await Promise.all([
    prisma.userUnit.findMany({ where: { userId: Number(userId) }, select: { unitId: true } }),
    prisma.unitRoleMap.findMany({ where: { role: { users: { some: { userId: Number(userId) } } } }, select: { unitId: true } }),
  ]);
  const unitIds = [...new Set([...direct, ...appointments].map((row) => row.unitId))];
  if (!unitIds.length) return new Set();
  const [members, roles] = await Promise.all([
    prisma.userUnit.findMany({ where: { unitId: { in: unitIds } }, select: { userId: true } }),
    prisma.unitRoleMap.findMany({ where: { unitId: { in: unitIds } }, select: { role: { select: { users: { select: { userId: true } } } } } }),
  ]);
  return new Set([...members.map((row) => Number(row.userId)), ...roles.flatMap((row) => row.role.users.map((member) => Number(member.userId)))]);
}

export function colleagueHandledWorkflow(history, colleagueIds) {
  return Array.isArray(history) && history.some((entry) =>
    ["approved", "returned", "rejected", "approve", "return", "reject"].includes(entry?.type) &&
    entry?.roleKey !== "requester" && entry?.stage !== "requester" &&
    colleagueIds.has(Number(entry?.byUserId ?? entry?.userId))
  );
}
