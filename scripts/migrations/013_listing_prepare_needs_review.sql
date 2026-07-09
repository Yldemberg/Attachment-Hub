-- Permite jobs de preparação que exigem revisão manual no iHub antes de publicar.
ALTER TYPE listing_prepare_job_status ADD VALUE IF NOT EXISTS 'needs_review';
