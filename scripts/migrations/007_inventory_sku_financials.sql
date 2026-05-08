-- Custos por SKU (imposto % + preço de compra) para inventário geral / relatórios
-- Aplicar no PostgreSQL (Replit) após migrações anteriores

CREATE TABLE IF NOT EXISTS public.inventory_sku_financials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sku             TEXT NOT NULL,
  tax_percent     NUMERIC(6, 3),
  purchase_price  NUMERIC(12, 2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_sku_financials_user_id_sku_unique
  ON public.inventory_sku_financials (user_id, sku);

COMMENT ON TABLE public.inventory_sku_financials IS 'Imposto e preço de compra por SKU (escopo usuário)';
