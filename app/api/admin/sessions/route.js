export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "../../../../lib/prisma";
import { cleanupExpiredSessions, requireAliSuperAdmin } from "../../../../lib/security";
import { logSessionEnd } from "../../../../lib/sessionActivityLog";
import { writeAuditLog } from "../../../../lib/auditLog";

function deviceDetails(userAgent) {
  const ua = String(userAgent || "");
  const browser = /edg\//i.test(ua) ? "Edge" : /chrome\//i.test(ua) ? "Chrome" : /firefox\//i.test(ua) ? "Firefox" : /safari\//i.test(ua) ? "Safari" : "Unknown";
  const os = /windows nt 10/i.test(ua) ? "Windows" : /iphone|ipad|ipod/i.test(ua) ? "iOS" : /android/i.test(ua) ? "Android" : /mac os x/i.test(ua) ? "macOS" : /linux/i.test(ua) ? "Linux" : "Unknown";
  const deviceType = /mobile|iphone|android/i.test(ua) ? "mobile" : /ipad|tablet/i.test(ua) ? "tablet" : "desktop";
  return { browser, os, deviceType };
}

export async function GET(request) {
  const auth = await requireAliSuperAdmin(request);
  if (auth.denied) return auth.denied;

  try {
    await cleanupExpiredSessions();
    const now = new Date();
    const sessions = await prisma.session.findMany({
      where: { expiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
      include: { user: { select: { id: true, name: true, username: true } } },
      orderBy: { lastActivityAt: "desc" },
      take: 500,
    });
    return Response.json({
      items: sessions.map((session) => ({
        ref: session.managementId,
        user: session.user,
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt,
        expiresAt: session.expiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
        ipAddress: session.ipAddress,
        ...deviceDetails(session.userAgent),
        online: new Date(session.lastActivityAt).getTime() >= Date.now() - 5 * 60 * 1000,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("admin_sessions_get_error", error);
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(request) {
  const auth = await requireAliSuperAdmin(request);
  if (auth.denied) return auth.denied;

  try {
    const body = await request.json().catch(() => ({}));
    const ref = String(body.ref || "").trim();
    const allForUser = Boolean(body.allForUser);
    if (!ref) return Response.json({ error: "session_required" }, { status: 400 });

    const target = await prisma.session.findUnique({ where: { managementId: ref }, include: { user: true } });
    if (!target) return Response.json({ error: "not_found" }, { status: 404 });
    if (target.id === request.cookies.get("ipm_session")?.value) {
      return Response.json({ error: "cannot_revoke_current_session" }, { status: 400 });
    }

    const targets = allForUser
      ? await prisma.session.findMany({ where: { userId: target.userId, id: { not: request.cookies.get("ipm_session")?.value || "" } }, select: { id: true } })
      : [{ id: target.id }];
    await Promise.all(targets.map((session) => logSessionEnd(session.id)));
    const result = allForUser
      ? await prisma.session.deleteMany({ where: { userId: target.userId, id: { not: request.cookies.get("ipm_session")?.value || "" } } })
      : await prisma.session.delete({ where: { id: target.id } }).then(() => ({ count: 1 }));
    await writeAuditLog({ request, actor: auth.user, action: allForUser ? "session.revoke_all" : "session.revoke", entityType: "session", entityId: target.managementId, severity: "warning", details: { targetUserId: target.userId, targetUsername: target.user?.username, count: result.count } });
    return Response.json({ ok: true, count: result.count });
  } catch (error) {
    console.error("admin_sessions_delete_error", error);
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
