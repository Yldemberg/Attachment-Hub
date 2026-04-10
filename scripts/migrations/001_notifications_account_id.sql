-- Migration 001: Add account_id column to notifications table
-- Applied: 2026-04-10
-- This adds a nullable FK to accounts so notifications can be linked to a specific
-- ML account. Existing rows will have NULL account_id (backwards-compatible).
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS account_id UUID
  REFERENCES accounts(id) ON DELETE SET NULL;
