-- ============================================================
-- BuildOrder.ai v6 — View Notifications + Expiry Tracking
-- Run in Supabase SQL Editor after buildorder-v5.sql
-- ============================================================

-- Track first time a client opens a share link
ALTER TABLE share_links
  ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ;
