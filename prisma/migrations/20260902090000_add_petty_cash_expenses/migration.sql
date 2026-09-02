CREATE TABLE IF NOT EXISTS petty_cash_expenses (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  expense_date VARCHAR(20) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  budget_code VARCHAR(80) NOT NULL,
  amount BIGINT NOT NULL,
  created_by_id INTEGER NOT NULL,
  stage VARCHAR(32) NOT NULL DEFAULT 'planning',
  planning_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  planning_by_id INTEGER,
  planning_at TIMESTAMP(3),
  project_manager_id INTEGER,
  project_manager_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  project_manager_by_id INTEGER,
  project_manager_at TIMESTAMP(3),
  rejected_by_id INTEGER,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE petty_cash_expenses
ADD COLUMN IF NOT EXISTS rejected_by_id INTEGER;

CREATE INDEX IF NOT EXISTS petty_cash_expenses_project_idx ON petty_cash_expenses(project_id);
CREATE INDEX IF NOT EXISTS petty_cash_expenses_assignee_idx ON petty_cash_expenses(project_manager_id, stage);
CREATE INDEX IF NOT EXISTS petty_cash_expenses_creator_idx ON petty_cash_expenses(created_by_id);

CREATE TABLE IF NOT EXISTS petty_cash_settlement_reports (
  id SERIAL PRIMARY KEY,
  report_number VARCHAR(40) NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  created_by_id INTEGER NOT NULL,
  prepared_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS petty_cash_settlement_report_items (
  id SERIAL PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES petty_cash_settlement_reports(id) ON DELETE CASCADE,
  expense_id INTEGER NOT NULL UNIQUE REFERENCES petty_cash_expenses(id) ON DELETE RESTRICT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(report_id, expense_id)
);

CREATE INDEX IF NOT EXISTS petty_cash_settlement_reports_project_idx ON petty_cash_settlement_reports(project_id);
CREATE INDEX IF NOT EXISTS petty_cash_settlement_report_items_report_idx ON petty_cash_settlement_report_items(report_id);
