-- Estoque mandatário: fonte lógica por (usuário, SKU) espelhada nos anúncios não Full.
-- Execute no Supabase SQL Editor se o projeto já existia antes desta tabela.

CREATE TABLE IF NOT EXISTS public.sku_mandate_inventory (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sku        TEXT NOT NULL,
  quantity   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, sku)
);

CREATE INDEX IF NOT EXISTS sku_mandate_inventory_user_id_idx ON public.sku_mandate_inventory(user_id);
