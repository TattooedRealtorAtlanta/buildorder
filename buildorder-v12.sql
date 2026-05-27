-- ============================================================
-- BuildOrder.ai v12 — Feedback
-- Run in Supabase SQL Editor after buildorder-v11.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS feedback (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  category    TEXT NOT NULL DEFAULT 'general',
  message     TEXT NOT NULL,
  page_url    TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Users can submit feedback (associated with their account or anonymous)
CREATE POLICY "Users can insert feedback"
  ON feedback FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
