ALTER TABLE "contract_information"
  ADD COLUMN IF NOT EXISTS "related_letter_ids" JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE "contract_information"
SET "related_letter_ids" = CASE
  WHEN jsonb_typeof(COALESCE("related_letter_ids", '[]'::jsonb)) = 'array'
    AND jsonb_array_length(COALESCE("related_letter_ids", '[]'::jsonb)) > 0
    THEN COALESCE("related_letter_ids", '[]'::jsonb)
  WHEN NULLIF("related_letter_id", '') IS NOT NULL
    THEN jsonb_build_array("related_letter_id")
  ELSE '[]'::jsonb
END;
