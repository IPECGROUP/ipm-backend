CREATE TABLE IF NOT EXISTS "UploadedFile" (
    "id" SERIAL NOT NULL,
    "sha256" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadedFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UploadedFile_sha256_key" ON "UploadedFile"("sha256");
CREATE INDEX IF NOT EXISTS "UploadedFile_createdAt_idx" ON "UploadedFile"("createdAt");
