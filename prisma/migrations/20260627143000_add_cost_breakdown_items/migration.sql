CREATE TABLE "cost_breakdown_items" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "budget_code" VARCHAR(80) NOT NULL,
    "budget_name" VARCHAR(255) NOT NULL,
    "base_budget" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_breakdown_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cost_breakdown_items_project_id_idx" ON "cost_breakdown_items"("project_id");

CREATE UNIQUE INDEX "cost_breakdown_items_project_id_budget_code_key" ON "cost_breakdown_items"("project_id", "budget_code");

ALTER TABLE "cost_breakdown_items"
ADD CONSTRAINT "cost_breakdown_items_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
