-- ============================================================
-- BuildOrder.ai v9 — Rate Library (Saved Line Items)
-- Run in Supabase SQL Editor after buildorder-v8.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS line_item_templates (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  unit        TEXT,
  unit_price  NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE line_item_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own line item templates"
  ON line_item_templates FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
