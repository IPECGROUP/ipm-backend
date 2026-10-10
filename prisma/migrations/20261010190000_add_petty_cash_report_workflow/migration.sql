ALTER TABLE petty_cash_expense_reports ADD COLUMN IF NOT EXISTS workflow_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE petty_cash_expense_reports ADD COLUMN IF NOT EXISTS review_history JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE petty_cash_expense_reports ADD COLUMN IF NOT EXISTS review_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE petty_cash_expense_reports ADD COLUMN IF NOT EXISTS initial_stage VARCHAR(32) NOT NULL DEFAULT 'planning';
ALTER TABLE petty_cash_expense_reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE petty_cash_expenses ADD COLUMN IF NOT EXISTS return_stage VARCHAR(32);
ALTER TABLE petty_cash_expenses ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) NOT NULL DEFAULT 'pending';
ALTER TABLE petty_cash_expenses ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT '';
