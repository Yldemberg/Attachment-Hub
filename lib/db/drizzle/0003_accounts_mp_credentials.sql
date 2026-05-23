ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "mp_client_id" text;
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "mp_client_secret" text;
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "mp_access_token" text;
