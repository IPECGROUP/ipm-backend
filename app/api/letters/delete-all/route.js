export const runtime = "nodejs";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAliSuperAdmin } from "@/lib/security";
import { writeAuditLog } from "@/lib/auditLog";

export async function DELETE(req) {
  const auth = await requireAliSuperAdmin(req);
  if (auth.denied) return auth.denied;
  try {
    const result = await prisma.letter.deleteMany({});
    await writeAuditLog({ request: req, actor: auth.user, action: "letter.delete_all", entityType: "letter", severity: "critical", details: { deleted: result.count, endpoint: "delete-all" } });
    return NextResponse.json({ ok: true, deleted: result.count });
  } catch (e) {
    await writeAuditLog({ request: req, actor: auth.user, action: "letter.delete_all", entityType: "letter", status: "failure", severity: "critical", details: { reason: e?.message || "delete_all_failed" } });
    return NextResponse.json(
      { ok: false, error: "delete_all_failed" },
      { status: 500 }
    );
  }
}
