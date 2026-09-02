-- Runtime compatibility updates for Docker deployments.
-- Keep these statements idempotent so container restarts are safe.
ALTER TABLE IF EXISTS "PaymentRequest"
ADD COLUMN IF NOT EXISTS "docDatesJalali" JSONB;
