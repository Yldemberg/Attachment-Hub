-- Snapshot de valores do pedido ML (subtotal itens, taxas, frete) para relatório de vendas.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS report_financials jsonb;
