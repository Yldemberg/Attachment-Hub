-- Corrige is_full a partir de logistic_type (sync antigo calculava isFull antes do enrich ML).

UPDATE products
SET is_full = TRUE,
    updated_at = NOW()
WHERE is_full IS DISTINCT FROM TRUE
  AND logistic_type ILIKE '%fulfillment%';

UPDATE products
SET is_full = FALSE,
    updated_at = NOW()
WHERE is_full IS TRUE
  AND (logistic_type IS NULL OR logistic_type NOT ILIKE '%fulfillment%');
