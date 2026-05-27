-- ============================================================
-- BuildOrder.ai v7 — Contractor Payment Info
-- Run in Supabase SQL Editor after buildorder-v6.sql
-- ============================================================

-- Payment methods shown on every invoice the contractor generates
ALTER TABLE contractor_profiles
  ADD COLUMN IF NOT EXISTS payment_venmo         TEXT,
  ADD COLUMN IF NOT EXISTS payment_zelle         TEXT,
  ADD COLUMN IF NOT EXISTS payment_cashapp       TEXT,
  ADD COLUMN IF NOT EXISTS payment_check_payable TEXT,
  ADD COLUMN IF NOT EXISTS payment_other         TEXT;
