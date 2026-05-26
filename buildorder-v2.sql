-- ============================================================
-- BuildOrder.ai v2 Schema Migration
-- Run this entire block in your Supabase SQL Editor
-- ============================================================

-- 1. Add billing columns to contractor_profiles
ALTER TABLE contractor_profiles
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- 2. Usage events — one row per document generated
CREATE TABLE IF NOT EXISTS usage_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_type   TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
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

-- 4. Signatures — both parties in one row (contractor + client/homeowner)
CREATE TABLE IF NOT EXISTS signatures (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id      UUID,
  contractor_sig   TEXT,   -- base64 PNG data URL
  client_sig       TEXT,   -- base64 PNG data URL
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own signatures" ON signatures
  FOR ALL USING (auth.uid() = user_id);

-- 5. Admin RPC functions — called via service role key only
CREATE OR REPLACE FUNCTION admin_get_stats()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  result JSON;
  v_free INT;
  v_pro  INT;
  v_biz  INT;
BEGIN
  SELECT COUNT(*) INTO v_free FROM contractor_profiles WHERE plan = 'free';
  SELECT COUNT(*) INTO v_pro  FROM contractor_profiles WHERE plan = 'pro';
  SELECT COUNT(*) INTO v_biz  FROM contractor_profiles WHERE plan = 'business';

  SELECT json_build_object(
    'total_users',     (SELECT COUNT(*) FROM contractor_profiles),
    'free_users',      v_free,
    'pro_users',       v_pro,
    'biz_users',       v_biz,
    'mrr',             (v_pro * 19) + (v_biz * 39),
    'total_docs',      (SELECT COUNT(*) FROM usage_events),
    'docs_this_month', (SELECT COUNT(*) FROM usage_events
                        WHERE created_at >= date_trunc('month', now()))
  ) INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION admin_get_recent_users(lim INT DEFAULT 50)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(row_to_json(u))
  FROM (
    SELECT
      cp.id,
      cp.email,
      cp.contractor_name,
      cp.business_name,
      cp.plan,
      cp.created_at,
      (SELECT COUNT(*) FROM usage_events WHERE user_id = cp.id) AS doc_count
    FROM contractor_profiles cp
    ORDER BY cp.created_at DESC
    LIMIT lim
  ) u
  INTO result;
  RETURN result;
END;
$$;
