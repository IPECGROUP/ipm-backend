ALTER TABLE petty_cash_expense_reports ADD COLUMN IF NOT EXISTS report_number VARCHAR(40);
ALTER TABLE petty_cash_expense_reports ADD COLUMN IF NOT EXISTS document_type VARCHAR(40) NOT NULL DEFAULT 'petty_cash_report';
CREATE UNIQUE INDEX IF NOT EXISTS petty_cash_expense_reports_number_key ON petty_cash_expense_reports(report_number);
