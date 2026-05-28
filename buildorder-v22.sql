-- ============================================================
-- BuildOrder.ai v22 — Google Review URL on contractor profiles
-- Run in Supabase SQL Editor after buildorder-v21.sql
-- ============================================================

ALTER TABLE contractor_profiles
  ADD COLUMN IF NOT EXISTS google_review_url TEXT;
