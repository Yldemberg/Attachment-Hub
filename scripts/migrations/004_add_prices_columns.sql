-- Add amount (promotional price) and regular_amount (list price) to products.
-- Populated via GET /items/prices during sync.
ALTER TABLE products ADD COLUMN IF NOT EXISTS amount DECIMAL(10, 2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS regular_amount DECIMAL(10, 2);
