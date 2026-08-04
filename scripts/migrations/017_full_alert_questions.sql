-- Alertas WhatsApp de novas perguntas (mesmo telefone / webhook N8N da Gestão Full)

ALTER TABLE full_settings
  ADD COLUMN IF NOT EXISTS alert_questions BOOLEAN NOT NULL DEFAULT TRUE;
