-- ============================================================
-- BuildOrder.ai v3 — Client Share Links
-- Run in Supabase SQL Editor after buildorder-v2.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS share_links (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token            TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  document_content TEXT NOT NULL,
  document_type    TEXT NOT NULL DEFAULT 'document',
  client_name      TEXT,
  client_email     TEXT,
  client_sig       TEXT,
  signed_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  expires_at       TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
);

ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;

-- Contractors manage their own links
CREATE POLICY "Contractors manage own links" ON share_links
  FOR ALL USING (auth.uid() = user_id);

-- Public can read any link by token (needed for sign.html — no auth)
CREATE POLICY "Public can read share links" ON share_links
  FOR SELECT USING (true);
