export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireAdmin } from "../../../../lib/security";
import { readAuditLogs, writeAuditLog } from "../../../../lib/auditLog";

function csvCell(value) {
  const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request) {
  const auth = await requireAdmin(request);
  if (auth.denied) return auth.denied;

  try {
    const url = new URL(request.url);
    const filters = {
      limit: url.searchParams.get("format") === "csv" ? 500 : url.searchParams.get("limit"),
      offset: url.searchParams.get("offset"),
      action: url.searchParams.get("action") || "",
      actor: url.searchParams.get("actor") || "",
      status: url.searchParams.get("status") || "",
      from: url.searchParams.get("from") || "",
      to: url.searchParams.get("to") || "",
    };
    const items = await readAuditLogs(filters);

    if (url.searchParams.get("format") === "csv") {
      const columns = ["id", "occurred_at", "actor_id", "actor_username", "action", "entity_type", "entity_id", "status", "severity", "ip_address", "request_id", "user_agent", "details"];
      const csv = [columns.join(","), ...items.map((row) => columns.map((key) => csvCell(row[key])).join(","))].join("\r\n");
      await writeAuditLog({ request, actor: auth.user, action: "audit.export", entityType: "audit_log", details: { rows: items.length, filters } });
      return new Response(`\uFEFF${csv}`, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="security-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("audit_logs_get_error", error);
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
