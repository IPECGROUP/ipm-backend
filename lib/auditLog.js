import { prisma } from "./prisma";
import { requestMetadata } from "./security";

let tableReady;

async function ensureAuditTable() {
  if (!tableReady) {
    tableReady = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS security_audit_logs (
          id BIGSERIAL PRIMARY KEY,
          occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          actor_id INTEGER NULL,
          actor_username TEXT NULL,
          action TEXT NOT NULL,
          entity_type TEXT NULL,
          entity_id TEXT NULL,
          status TEXT NOT NULL DEFAULT 'success',
          severity TEXT NOT NULL DEFAULT 'info',
          ip_address TEXT NULL,
          user_agent TEXT NULL,
          request_id TEXT NULL,
          details JSONB NOT NULL DEFAULT '{}'::jsonb
        )
      `);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS security_audit_logs_time_idx ON security_audit_logs (occurred_at DESC)`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS security_audit_logs_action_idx ON security_audit_logs (action, occurred_at DESC)`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS security_audit_logs_actor_idx ON security_audit_logs (actor_id, occurred_at DESC)`);
    })().catch((error) => {
      tableReady = undefined;
      throw error;
    });
  }
  return tableReady;
}

const SECRET_KEYS = /password|pass|secret|token|cookie|authorization/i;

function safeDetails(value, depth = 0) {
  if (depth > 4) return "[truncated]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 2000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeDetails(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [
      key,
      SECRET_KEYS.test(key) ? "[redacted]" : safeDetails(item, depth + 1),
    ]));
  }
  return String(value).slice(0, 2000);
}

export async function writeAuditLog({ request, actor, action, entityType = null, entityId = null, status = "success", severity = "info", details = {} }) {
  try {
    await ensureAuditTable();
    const meta = requestMetadata(request);
    await prisma.$executeRaw`
      INSERT INTO security_audit_logs
        (actor_id, actor_username, action, entity_type, entity_id, status, severity, ip_address, user_agent, request_id, details)
      VALUES
        (${actor?.id ? Number(actor.id) : null}, ${actor?.username || actor?.email || null}, ${String(action)},
         ${entityType ? String(entityType) : null}, ${entityId == null ? null : String(entityId)}, ${String(status)}, ${String(severity)},
         ${meta.ip}, ${meta.userAgent}, ${meta.requestId}, ${JSON.stringify(safeDetails(details))}::jsonb)
    `;
  } catch (error) {
    console.error("security_audit_write_error", { action, message: error?.message });
  }
}

export async function readAuditLogs({ limit = 100, offset = 0, action = "", actor = "", status = "", from = "", to = "" } = {}) {
  await ensureAuditTable();
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const rows = await prisma.$queryRaw`
    SELECT id::text, occurred_at, actor_id, actor_username, action, entity_type, entity_id,
           status, severity, ip_address, user_agent, request_id, details
    FROM security_audit_logs
    WHERE (${action || null}::text IS NULL OR action ILIKE ${action ? `%${action}%` : null})
      AND (${actor || null}::text IS NULL OR actor_username ILIKE ${actor ? `%${actor}%` : null} OR actor_id::text = ${actor || null})
      AND (${status || null}::text IS NULL OR status = ${status || null})
      AND (${from || null}::timestamptz IS NULL OR occurred_at >= ${from || null}::timestamptz)
      AND (${to || null}::timestamptz IS NULL OR occurred_at <= ${to || null}::timestamptz)
    ORDER BY occurred_at DESC
    LIMIT ${safeLimit} OFFSET ${safeOffset}
  `;
  return rows;
}
