CREATE TABLE IF NOT EXISTS "contract_information_drafts" (
  "draft_key" TEXT NOT NULL,
  "contract_id" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "last_saved_section" VARCHAR(40),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contract_information_drafts_pkey" PRIMARY KEY ("draft_key")
);

CREATE INDEX IF NOT EXISTS "contract_information_drafts_contract_id_idx"
  ON "contract_information_drafts"("contract_id");
