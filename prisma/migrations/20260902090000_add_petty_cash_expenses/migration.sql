CREATE TABLE "petty_cash_expenses" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "expense_date" VARCHAR(20) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "budget_code" VARCHAR(80) NOT NULL,
    "amount" BIGINT NOT NULL,
    "created_by_id" INTEGER NOT NULL,
    "stage" VARCHAR(32) NOT NULL DEFAULT 'planning',
    "planning_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "planning_by_id" INTEGER,
    "planning_at" TIMESTAMP(3),
    "project_manager_id" INTEGER,
    "project_manager_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "project_manager_by_id" INTEGER,
    "project_manager_at" TIMESTAMP(3),
    "rejected_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "petty_cash_expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "petty_cash_expenses_project_idx" ON "petty_cash_expenses"("project_id");
CREATE INDEX "petty_cash_expenses_assignee_idx" ON "petty_cash_expenses"("project_manager_id", "stage");
CREATE INDEX "petty_cash_expenses_creator_idx" ON "petty_cash_expenses"("created_by_id");

ALTER TABLE "petty_cash_expenses"
ADD CONSTRAINT "petty_cash_expenses_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
