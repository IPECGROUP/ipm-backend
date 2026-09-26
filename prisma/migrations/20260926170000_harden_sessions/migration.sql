ALTER TABLE "Session"
  ADD COLUMN IF NOT EXISTS "management_id" TEXT,
  ADD COLUMN IF NOT EXISTS "last_activity_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "absolute_expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ip_address" TEXT,
  ADD COLUMN IF NOT EXISTS "user_agent" TEXT;

UPDATE "Session"
SET
  "management_id" = COALESCE("management_id", md5(id || random()::text || clock_timestamp()::text)),
  "last_activity_at" = COALESCE("last_activity_at", "createdAt"),
  "absolute_expires_at" = COALESCE("absolute_expires_at", "createdAt" + INTERVAL '8 hours');

ALTER TABLE "Session"
  ALTER COLUMN "management_id" SET NOT NULL,
  ALTER COLUMN "last_activity_at" SET NOT NULL,
  ALTER COLUMN "absolute_expires_at" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Session_management_id_key" ON "Session"("management_id");
CREATE INDEX IF NOT EXISTS "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX IF NOT EXISTS "Session_absolute_expires_at_idx" ON "Session"("absolute_expires_at");
