CREATE TABLE IF NOT EXISTS "contract_information" (
  "id" TEXT NOT NULL,
  "project_id" INTEGER,
  "document_type" VARCHAR(20) NOT NULL DEFAULT 'main',
  "contract_no" TEXT,
  "parent_contract_id" TEXT,
  "related_letter_id" TEXT,
  "general" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "calendar" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "technical" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "financial" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "insurance" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "last_saved_section" VARCHAR(40),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contract_information_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contract_information_project_id_fkey'
  ) THEN
    ALTER TABLE "contract_information"
    ADD CONSTRAINT "contract_information_project_id_fkey"
    FOREIGN KEY ("project_id")
    REFERENCES "projects"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "contract_information_project_id_idx"
  ON "contract_information"("project_id");

CREATE INDEX IF NOT EXISTS "contract_information_document_type_idx"
  ON "contract_information"("document_type");

CREATE INDEX IF NOT EXISTS "contract_information_parent_contract_id_idx"
  ON "contract_information"("parent_contract_id");

CREATE INDEX IF NOT EXISTS "contract_information_related_letter_id_idx"
  ON "contract_information"("related_letter_id");
