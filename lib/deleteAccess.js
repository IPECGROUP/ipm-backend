import { prisma } from "./prisma";

export async function canDeleteFinancialRecords(userId) {
  const user = await prisma.user.findUnique({ where: { id: Number(userId) }, select: { username: true } });
  return ["ali", "marandi"].includes(String(user?.username || "").trim().toLowerCase());
}
