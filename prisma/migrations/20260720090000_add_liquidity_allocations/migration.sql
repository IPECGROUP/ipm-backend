CREATE TABLE "liquidity_allocations" (
  "id" SERIAL NOT NULL,
  "allocation_date" VARCHAR(20) NOT NULL,
  "source" VARCHAR(255) NOT NULL,
  "available_amount" BIGINT NOT NULL,
  "description" TEXT DEFAULT '',
  "project_id" INTEGER,
  "amount" BIGINT NOT NULL,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "liquidity_allocations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "liquidity_allocations_project_id_idx" ON "liquidity_allocations"("project_id");
CREATE INDEX "liquidity_allocations_created_at_idx" ON "liquidity_allocations"("created_at");
