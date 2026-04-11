-- Normalize question status values to lowercase.
-- ML API returns statuses in UPPERCASE ("UNANSWERED", "ANSWERED", "CLOSED_UNANSWERED").
-- All application code expects lowercase. This migration normalizes existing rows.
UPDATE questions
SET status = LOWER(status)
WHERE status <> LOWER(status);
