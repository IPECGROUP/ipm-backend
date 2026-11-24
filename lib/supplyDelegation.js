// Supply-only delegation. Preserve original ownership and record the actual actor.
export async function supplyDelegatedUserId(prisma, authenticatedUser) {
  if (String(authenticatedUser?.username || "").trim().toLowerCase() !== "balouchi") return null;
  const users = await prisma.user.findMany({ where: { username: { equals: "esmaeili", mode: "insensitive" } }, select: { id: true }, take: 2 });
  return users.length === 1 ? Number(users[0].id) : null;
}
