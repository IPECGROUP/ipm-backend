ALTER TABLE "PaymentRequest"
ADD COLUMN "requestedAmountDecimal" DECIMAL(30, 2);

UPDATE "PaymentRequest"
SET "requestedAmountDecimal" = "amount"::numeric
WHERE "requestedAmountDecimal" IS NULL;
