-- ============================================================
-- BuildOrder.ai v23 — Recurring invoices + Client portal tokens
-- Run in Supabase SQL Editor after buildorder-v22.sql
-- ============================================================

-- Recurring invoice fields
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS recurrence       TEXT,   -- 'weekly' | 'biweekly' | 'monthly' | 'quarterly'
  ADD COLUMN IF NOT EXISTS next_recur_date  DATE,   -- cron checks this daily
  ADD COLUMN IF NOT EXISTS recur_source_id  UUID;   -- id of the invoice that spawned this one

-- Client document portal tokens
CREATE TABLE IF NOT EXISTS portal_tokens (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token               TEXT        UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  contractor_user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_email        TEXT        NOT NULL,
  client_name         TEXT,
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '90 days',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE portal_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contractors manage own portal tokens"
  ON portal_tokens FOR ALL
  USING  (auth.uid() = contractor_user_id)
  WITH CHECK (auth.uid() = contractor_user_id);

CREATE INDEX IF NOT EXISTS portal_tokens_user_email ON portal_tokens (contractor_user_id, client_email);
