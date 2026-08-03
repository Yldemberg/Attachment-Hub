-- Defaults recomendados Gestão Full (lead 12, meta 25, período 15, parado off no Zap)

ALTER TABLE full_settings
  ALTER COLUMN coverage_target_days SET DEFAULT 25,
  ALTER COLUMN lead_time_days SET DEFAULT 12,
  ALTER COLUMN sales_period_days SET DEFAULT 15,
  ALTER COLUMN alert_parado SET DEFAULT FALSE;

-- Contas ainda nos defaults de fábrica do MVP → aplicar recomendado
UPDATE full_settings
SET
  coverage_target_days = 25,
  lead_time_days = 12,
  sales_period_days = 15,
  alert_parado = FALSE,
  updated_at = NOW()
WHERE coverage_target_days = 30
  AND lead_time_days = 5
  AND sales_period_days = 30;
