-- catalog_listing from ML GET /items (JSON catalog_listing: true)
ALTER TABLE products ADD COLUMN IF NOT EXISTS catalog_listing BOOLEAN NOT NULL DEFAULT FALSE;
