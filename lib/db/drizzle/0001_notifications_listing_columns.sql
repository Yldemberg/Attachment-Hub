ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "listing_thumbnail_url" text;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "listing_permalink" text;
