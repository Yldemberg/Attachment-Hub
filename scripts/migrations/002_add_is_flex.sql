-- Add is_flex boolean column to products table
-- Populated during sync from item.tags[] containing "self_service_in"
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_flex BOOLEAN NOT NULL DEFAULT FALSE;
