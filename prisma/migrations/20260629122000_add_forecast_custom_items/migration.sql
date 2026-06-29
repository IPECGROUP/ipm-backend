CREATE TABLE "cost_forecast_items" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "parent_code" VARCHAR(80),
    "code" VARCHAR(80) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "row_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_forecast_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cost_forecast_items_project_id_code_key" ON "cost_forecast_items"("project_id", "code");
CREATE INDEX "cost_forecast_items_project_id_idx" ON "cost_forecast_items"("project_id");

ALTER TABLE "cost_forecast_items"
ADD CONSTRAINT "cost_forecast_items_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "revenue_forecast_items" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "parent_code" VARCHAR(80),
    "code" VARCHAR(80) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "row_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revenue_forecast_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "revenue_forecast_items_project_id_code_key" ON "revenue_forecast_items"("project_id", "code");
CREATE INDEX "revenue_forecast_items_project_id_idx" ON "revenue_forecast_items"("project_id");

ALTER TABLE "revenue_forecast_items"
ADD CONSTRAINT "revenue_forecast_items_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
