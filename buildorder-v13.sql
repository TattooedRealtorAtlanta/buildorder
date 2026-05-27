-- ============================================================
-- BuildOrder.ai v13 — send-document tracking
-- Run in Supabase SQL Editor after buildorder-v12.sql
-- ============================================================

ALTER TABLE share_links ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
