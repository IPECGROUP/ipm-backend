-- CreateTable
CREATE TABLE "roznegar_entries" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "date_ymd" VARCHAR(10) NOT NULL,
    "day_name" VARCHAR(30) NOT NULL,
    "activity" TEXT,
    "tag_ids" JSONB,
    "related_doc_ids" JSONB,
    "files" JSONB,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roznegar_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roznegar_entries_project_id_user_id_date_ymd_key" ON "roznegar_entries"("project_id", "user_id", "date_ymd");

-- CreateIndex
CREATE INDEX "roznegar_entries_project_id_idx" ON "roznegar_entries"("project_id");

-- CreateIndex
CREATE INDEX "roznegar_entries_user_id_idx" ON "roznegar_entries"("user_id");

-- CreateIndex
CREATE INDEX "roznegar_entries_date_ymd_idx" ON "roznegar_entries"("date_ymd");

-- CreateIndex
CREATE INDEX "roznegar_entries_confirmed_idx" ON "roznegar_entries"("confirmed");

-- AddForeignKey
ALTER TABLE "roznegar_entries" ADD CONSTRAINT "roznegar_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roznegar_entries" ADD CONSTRAINT "roznegar_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
