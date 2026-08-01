-- Gestão Full: settings, snapshot de estoque CD, log de alertas WhatsApp

CREATE TABLE IF NOT EXISTS full_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  coverage_target_days INTEGER NOT NULL DEFAULT 30,
  lead_time_days INTEGER NOT NULL DEFAULT 5,
  sales_period_days INTEGER NOT NULL DEFAULT 30,
  stuck_multiplier INTEGER NOT NULL DEFAULT 2,
  whatsapp_phone TEXT,
  alerts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  alert_ruptura BOOLEAN NOT NULL DEFAULT TRUE,
  alert_critico BOOLEAN NOT NULL DEFAULT TRUE,
  alert_parado BOOLEAN NOT NULL DEFAULT TRUE,
  alert_cooldown_hours INTEGER NOT NULL DEFAULT 24,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS full_settings_user_account_unique
  ON full_settings (user_id, account_id);

CREATE TABLE IF NOT EXISTS full_stock_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  ml_item_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  inventory_id TEXT NOT NULL,
  available_quantity INTEGER NOT NULL DEFAULT 0,
  not_available_quantity INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS full_stock_snapshot_account_inventory_unique
  ON full_stock_snapshot (account_id, inventory_id);

CREATE INDEX IF NOT EXISTS full_stock_snapshot_account_sku_idx
  ON full_stock_snapshot (account_id, sku);

CREATE TABLE IF NOT EXISTS full_alert_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS full_alert_log_lookup_idx
  ON full_alert_log (user_id, account_id, sku, alert_type, sent_at);
