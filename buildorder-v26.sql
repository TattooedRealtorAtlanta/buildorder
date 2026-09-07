-- ============================================================
-- BuildOrder.ai v26 — Founding Member Email Sequence (Days 3/7/14/30/55)
-- Run in Supabase SQL Editor after buildorder-v25.sql
-- ============================================================

ALTER TABLE contractor_profiles
  ADD COLUMN IF NOT EXISTS founding_warn3_sent  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS founding_warn7_sent  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS founding_warn14_sent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS founding_warn30_sent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS founding_warn55_sent BOOLEAN NOT NULL DEFAULT false;
