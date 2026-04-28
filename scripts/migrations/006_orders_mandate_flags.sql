-- Idempotência da baixa / estorno mandatório de estoque por pedido ML
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS mandate_sale_applied BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS mandate_cancel_applied BOOLEAN NOT NULL DEFAULT FALSE;
