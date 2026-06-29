CREATE TABLE "cost_forecast_projects" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_forecast_projects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cost_forecast_values" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "budget_code" VARCHAR(80) NOT NULL,
    "month_key" VARCHAR(12) NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_forecast_values_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cost_forecast_projects_project_id_key" ON "cost_forecast_projects"("project_id");
CREATE INDEX "cost_forecast_projects_project_id_idx" ON "cost_forecast_projects"("project_id");

CREATE UNIQUE INDEX "cost_forecast_values_project_id_budget_code_month_key_key" ON "cost_forecast_values"("project_id", "budget_code", "month_key");
CREATE INDEX "cost_forecast_values_project_id_idx" ON "cost_forecast_values"("project_id");
CREATE INDEX "cost_forecast_values_project_id_budget_code_idx" ON "cost_forecast_values"("project_id", "budget_code");

ALTER TABLE "cost_forecast_projects"
ADD CONSTRAINT "cost_forecast_projects_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cost_forecast_values"
ADD CONSTRAINT "cost_forecast_values_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
