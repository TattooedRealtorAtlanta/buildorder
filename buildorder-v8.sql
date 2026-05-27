-- ============================================================
-- BuildOrder.ai v8 — Expiry Reminder Tracking
-- Run in Supabase SQL Editor after buildorder-v7.sql
-- ============================================================

-- Track when the 3-day expiry reminder was sent so we never double-email
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
