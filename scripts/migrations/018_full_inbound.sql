-- Envios Full planejados (registro manual no iHub) para em_transito e mute de WhatsApp

CREATE TABLE IF NOT EXISTS full_inbound_shipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_transit', 'received', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS full_inbound_shipment_account_status_idx
  ON full_inbound_shipment (account_id, status);

CREATE INDEX IF NOT EXISTS full_inbound_shipment_user_account_idx
  ON full_inbound_shipment (user_id, account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS full_inbound_shipment_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES full_inbound_shipment(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  ml_item_id TEXT,
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  quantity_remaining INTEGER NOT NULL CHECK (quantity_remaining >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS full_inbound_shipment_item_shipment_idx
  ON full_inbound_shipment_item (shipment_id);

CREATE INDEX IF NOT EXISTS full_inbound_shipment_item_sku_idx
  ON full_inbound_shipment_item (sku);
