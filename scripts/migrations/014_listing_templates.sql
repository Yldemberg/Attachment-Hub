-- Modelos de anúncio: snapshot completo dos listings ML para recriar anúncios.
CREATE TABLE IF NOT EXISTS listing_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  source_product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  source_ml_item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  thumbnail TEXT,
  category_id TEXT,
  listing_type_id TEXT,
  condition TEXT,
  source_status TEXT,
  is_full BOOLEAN NOT NULL DEFAULT FALSE,
  is_catalog BOOLEAN NOT NULL DEFAULT FALSE,
  has_variations BOOLEAN NOT NULL DEFAULT FALSE,
  payload_json JSONB NOT NULL,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS listing_templates_user_account_ml_item_unique
  ON listing_templates (user_id, source_account_id, source_ml_item_id);

CREATE INDEX IF NOT EXISTS listing_templates_user_id_idx
  ON listing_templates (user_id);

CREATE INDEX IF NOT EXISTS listing_templates_source_account_id_idx
  ON listing_templates (source_account_id);
