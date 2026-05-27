-- ============================================================
-- BuildOrder.ai v14 — Change Orders
-- Run in Supabase SQL Editor after buildorder-v13.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS change_orders (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                 UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  homeowner_name          TEXT NOT NULL,
  homeowner_email         TEXT,
  homeowner_phone         TEXT,
  job_address             TEXT,
  job_city                TEXT,
  job_state               TEXT,
  work_type               TEXT,
  original_scope          TEXT,
  original_contract_price NUMERIC(10,2),
  change_description      TEXT NOT NULL,
  reason                  TEXT,
  change_amount           NUMERIC(10,2) DEFAULT 0,
  new_total               NUMERIC(10,2),
  additional_days         INT DEFAULT 0,
  notes                   TEXT,
  content                 TEXT,
  status                  TEXT NOT NULL DEFAULT 'draft',
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE change_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own change orders"
  ON change_orders FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
