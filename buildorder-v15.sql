-- BuildOrder v15: Client Portal Tokens
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS portal_tokens (
  token          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  contractor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_email   TEXT NOT NULL,
  client_name    TEXT,
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE portal_tokens ENABLE ROW LEVEL SECURITY;

-- No public RLS policies — all access is via service key in /api/portal
-- Contractors cannot read each other's tokens

CREATE INDEX IF NOT EXISTS portal_tokens_contractor_idx
  ON portal_tokens(contractor_user_id, client_email);
