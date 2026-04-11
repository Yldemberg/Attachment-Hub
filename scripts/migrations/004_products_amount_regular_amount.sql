-- ML item prices API: GET /items/{ITEM_ID}/prices → prices[].amount, prices[].regular_amount
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS amount DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS regular_amount DECIMAL(10, 2);
