-- ============================================================
-- BuildOrder.ai v5 — Founding Member Override
-- Run in Supabase SQL Editor after buildorder-v4.sql
-- ============================================================

-- Add founding member columns to contractor_profiles
ALTER TABLE contractor_profiles
  ADD COLUMN IF NOT EXISTS founding_member BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pro_expires_at  TIMESTAMPTZ;

-- To grant a user founding member access, run this in SQL Editor:
-- UPDATE contractor_profiles
--   SET founding_member = true, pro_expires_at = '2027-01-01 00:00:00+00'
--   WHERE id = '<user_uuid>';
