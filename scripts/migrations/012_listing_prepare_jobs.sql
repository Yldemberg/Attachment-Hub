-- Jobs assíncronos para preparação de anúncios via N8N (link Amazon/Shopee).
CREATE TYPE listing_prepare_job_status AS ENUM ('pending', 'processing', 'completed', 'failed');

CREATE TABLE listing_prepare_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_url TEXT NOT NULL,
  status listing_prepare_job_status NOT NULL DEFAULT 'pending',
  draft_json JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX listing_prepare_jobs_user_id_idx ON listing_prepare_jobs (user_id);
CREATE INDEX listing_prepare_jobs_status_idx ON listing_prepare_jobs (status);
