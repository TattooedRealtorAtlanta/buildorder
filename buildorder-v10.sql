-- ============================================================
-- BuildOrder.ai v10 — Payment Collection
-- Run in Supabase SQL Editor after buildorder-v9.sql
-- ============================================================

-- Contractor's connected Stripe account ID
ALTER TABLE contractor_profiles
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;

-- On share links: which doc was shared, how much, and when it was paid
ALTER TABLE share_links
  ADD COLUMN IF NOT EXISTS reference_id    TEXT,
  ADD COLUMN IF NOT EXISTS payment_amount  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS paid_at         TIMESTAMPTZ;
