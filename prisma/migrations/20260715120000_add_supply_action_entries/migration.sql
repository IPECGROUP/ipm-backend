CREATE TABLE IF NOT EXISTS "supply_action_entries" (
  "id" TEXT NOT NULL,
  "request_id" INTEGER NOT NULL,
  "action_date" VARCHAR(20),
  "action_time" VARCHAR(8),
  "description" TEXT,
  "status" VARCHAR(30) NOT NULL DEFAULT 'in_progress',
  "files" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "created_by" INTEGER,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supply_action_entries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "supply_action_entries"
  ADD COLUMN IF NOT EXISTS "action_time" VARCHAR(8);

CREATE INDEX IF NOT EXISTS "supply_action_entries_request_id_idx"
  ON "supply_action_entries"("request_id");

CREATE INDEX IF NOT EXISTS "supply_action_entries_created_by_idx"
  ON "supply_action_entries"("created_by");
