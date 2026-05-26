-- ============================================================
-- BuildOrder.ai v2 Schema Migration
-- Run this in your Supabase SQL Editor (in order)
-- ============================================================

-- 1. Add billing columns to contractor_profiles
ALTER TABLE contractor_profiles
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- 2. Usage events — one row per document generated
CREATE TABLE IF NOT EXISTS usage_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_type      TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own usage" ON usage_events
  FOR SELECT USING (auth.uid() = user_id);

-- 3. Clients — reusable contact book
CREATE TABLE IF NOT EXISTS clients (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  company    TEXT,
  phone      TEXT,
  email      TEXT,
  address    TEXT,
  city       TEXT,
  state      TEXT,
  zip        TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own clients" ON clients
  FOR ALL USING (auth.uid() = user_id);

-- 4. Signatures — e-signature storage
CREATE TABLE IF NOT EXISTS signatures (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id      UUID,
  job_id           UUID REFERENCES jobs(id) ON DELETE CASCADE,
  signer_type      TEXT NOT NULL,   -- 'contractor' | 'homeowner' | 'client'
  signature_data   TEXT NOT NULL,   -- base64 data URL
  signed_at        TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own signatures" ON signatures
  FOR ALL USING (auth.uid() = user_id);

-- 5. Admin RPC — call via service role only
CREATE OR REPLACE FUNCTION admin_get_stats()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'total_users',    (SELECT COUNT(*) FROM contractor_profiles),
    'free_users',     (SELECT COUNT(*) FROM contractor_profiles WHERE plan = 'free'),
    'pro_users',      (SELECT COUNT(*) FROM contractor_profiles WHERE plan = 'pro'),
    'business_users', (SELECT COUNT(*) FROM contractor_profiles WHERE plan = 'business'),
    'docs_this_month',(SELECT COUNT(*) FROM usage_events
                       WHERE created_at >= date_trunc('month', now())),
    'total_docs',     (SELECT COUNT(*) FROM usage_events),
    'total_clients',  (SELECT COUNT(*) FROM clients)
  ) INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION admin_get_recent_users(lim INT DEFAULT 20)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(row_to_json(u))
  FROM (
    SELECT
      cp.id,
      cp.contractor_name,
      cp.email,
      cp.plan,
      cp.created_at,
      (SELECT COUNT(*) FROM usage_events WHERE user_id = cp.id) AS total_docs,
      (SELECT COUNT(*) FROM usage_events
       WHERE user_id = cp.id AND created_at >= date_trunc('month', now())) AS docs_this_month
    FROM contractor_profiles cp
    ORDER BY cp.created_at DESC
    LIMIT lim
  ) u
  INTO result;
  RETURN result;
END;
$$;
