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
);

CREATE INDEX IF NOT EXISTS security_audit_logs_time_idx ON security_audit_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS security_audit_logs_action_idx ON security_audit_logs (action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS security_audit_logs_actor_idx ON security_audit_logs (actor_id, occurred_at DESC);
