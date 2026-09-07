-- ============================================================
-- BuildOrder.ai v27 — Founding Member Post-Expiry Win-Back (Days +1/+7/+30)
-- Run in Supabase SQL Editor after buildorder-v26.sql
--
-- The founding member sequence (v24/v26) ends at day 60 with the
-- "expires tomorrow" notice. These three flags drive the touches that
-- fire AFTER pro_expires_at has passed, which previously had no coverage.
-- ============================================================

ALTER TABLE contractor_profiles
  ADD COLUMN IF NOT EXISTS founding_lapsed1_sent  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS founding_lapsed7_sent  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS founding_lapsed30_sent BOOLEAN NOT NULL DEFAULT false;
