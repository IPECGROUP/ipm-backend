ALTER TABLE "Letter"
ADD COLUMN IF NOT EXISTS "classification_label" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'TagCategory'
  ) THEN
    UPDATE "Letter" AS l
    SET "classification_label" = tc."label"
    FROM "TagCategory" AS tc
    WHERE l."classification_id" = tc."id"
      AND (l."classification_label" IS NULL OR btrim(l."classification_label") = '');
  END IF;
END $$;
