-- Snapshot de anúncios pausados pelo Modo Férias (reativação simétrica ao desligar)
CREATE TABLE IF NOT EXISTS vacation_mode_pauses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  paused_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS vacation_mode_pauses_user_product_unique
  ON vacation_mode_pauses (user_id, product_id);
