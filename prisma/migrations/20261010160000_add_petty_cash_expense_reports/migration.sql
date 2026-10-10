CREATE TABLE IF NOT EXISTS petty_cash_expense_reports (
  id SERIAL PRIMARY KEY,
  report_name VARCHAR(180) NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  created_by_id INTEGER NOT NULL,
  submission_key UUID NOT NULL UNIQUE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE petty_cash_expenses ADD COLUMN IF NOT EXISTS expense_report_id INTEGER
  REFERENCES petty_cash_expense_reports(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS petty_cash_expense_reports_creator_idx ON petty_cash_expense_reports(created_by_id);
CREATE INDEX IF NOT EXISTS petty_cash_expenses_report_idx ON petty_cash_expenses(expense_report_id);
