-- Histórico de movimentação de estoque por SKU (append-only).
-- Aplicar no PostgreSQL após migrações anteriores.

CREATE TABLE IF NOT EXISTS public.sku_inventory_movements (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sku                  TEXT NOT NULL,
  source               TEXT NOT NULL,
  operation            TEXT NOT NULL,
  quantity_before      INTEGER NOT NULL,
  quantity_delta       INTEGER NOT NULL,
  quantity_after       INTEGER NOT NULL,
  actor_user_id        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  related_order_id     TEXT,
  related_product_id   UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sku_inventory_movements_user_sku_created_idx
  ON public.sku_inventory_movements (user_id, sku, created_at DESC);

CREATE INDEX IF NOT EXISTS sku_inventory_movements_user_created_idx
  ON public.sku_inventory_movements (user_id, created_at DESC);

COMMENT ON TABLE public.sku_inventory_movements IS
  'Livro de movimentações de estoque por SKU (manual, produto, venda, cancelamento, sync)';
