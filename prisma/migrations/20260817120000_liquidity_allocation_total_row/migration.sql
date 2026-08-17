ALTER TABLE "liquidity_allocations"
  ADD COLUMN IF NOT EXISTS "batch_id" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "row_type" VARCHAR(20) NOT NULL DEFAULT 'project';

-- Project-less legacy entries hold the contingency balance.
UPDATE "liquidity_allocations"
SET "row_type" = 'contingency_reserve'
WHERE "project_id" IS NULL AND "row_type" IN ('project', 'total');

CREATE INDEX IF NOT EXISTS "liquidity_allocations_batch_id_idx"
  ON "liquidity_allocations"("batch_id");
