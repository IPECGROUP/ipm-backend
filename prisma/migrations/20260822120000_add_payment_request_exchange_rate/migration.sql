ALTER TABLE "PaymentRequest"
  ADD COLUMN IF NOT EXISTS "exchangeRate" BIGINT,
  ADD COLUMN IF NOT EXISTS "rialAmount" BIGINT;

-- Existing payment requests were entered in rial, so their original amount
-- remains the authoritative rial value.
UPDATE "PaymentRequest"
SET "rialAmount" = "amount"
WHERE "rialAmount" IS NULL;
