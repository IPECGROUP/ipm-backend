ALTER TABLE petty_cash_expenses ADD COLUMN IF NOT EXISTS file_name VARCHAR(180);
ALTER TABLE petty_cash_expenses ADD COLUMN IF NOT EXISTS file_url TEXT;
