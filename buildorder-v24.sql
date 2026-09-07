-- ============================================================
-- BuildOrder.ai v24 — Founding Member Email Tracking
-- Run in Supabase SQL Editor after buildorder-v23.sql
-- ============================================================

-- Prevents the Day 45 and Day 60 cron emails from resending
-- if the cron runs multiple times while a user is in the window.
ALTER TABLE contractor_profiles
  ADD COLUMN IF NOT EXISTS founding_warn45_sent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS founding_warn60_sent BOOLEAN NOT NULL DEFAULT false;
