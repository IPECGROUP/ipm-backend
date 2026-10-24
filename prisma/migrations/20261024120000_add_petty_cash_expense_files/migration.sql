ALTER TABLE petty_cash_expenses
  ADD COLUMN IF NOT EXISTS files JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE petty_cash_expenses
SET files = jsonb_build_array(jsonb_build_object('name', file_name, 'url', file_url))
WHERE file_url IS NOT NULL AND file_url <> '' AND files = '[]'::jsonb;
