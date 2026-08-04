-- Speeds up the ownership/public-letter branch of the documents list while
-- retaining its newest-first ordering.
CREATE INDEX IF NOT EXISTS "Letter_createdBy_id_idx"
ON "Letter" ("createdBy", "id" DESC);
