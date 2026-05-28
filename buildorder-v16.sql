-- BuildOrder v16: Business Plan Multi-User (Team Members)
-- Run in Supabase SQL Editor

-- ── 1. team_members table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_members (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_email    TEXT        NOT NULL,
  member_user_id  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  token           TEXT        UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  status          TEXT        NOT NULL DEFAULT 'pending', -- pending | active | removed
  invited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  joined_at       TIMESTAMPTZ
);

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
-- All access via service role in /api/team — no public policies needed.

CREATE INDEX IF NOT EXISTS tm_owner_idx  ON team_members(owner_user_id);
CREATE INDEX IF NOT EXISTS tm_member_idx ON team_members(member_user_id);
CREATE INDEX IF NOT EXISTS tm_token_idx  ON team_members(token);


-- ── 2. get_owner_id() — resolves the effective user_id for RLS ───────────
-- Returns the owner's user_id if the current user is an active team member,
-- otherwise returns auth.uid() (the user's own id).
CREATE OR REPLACE FUNCTION get_owner_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER   -- runs with definer rights so it can read team_members
STABLE             -- same result within a transaction
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;

  SELECT owner_user_id INTO v_owner
  FROM   team_members
  WHERE  member_user_id = auth.uid()
    AND  status = 'active'
  LIMIT  1;

  RETURN COALESCE(v_owner, auth.uid());
END;
$$;


-- ── 3. Auto-set user_id trigger ─────────────────────────────────────────
-- Runs BEFORE INSERT on each table so team member inserts automatically
-- get the owner's user_id without any frontend change.
CREATE OR REPLACE FUNCTION set_effective_user_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.user_id := get_owner_id();
  RETURN NEW;
END;
$$;

-- Apply trigger to all document tables
DO $$ BEGIN

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'estimates_set_owner') THEN
    CREATE TRIGGER estimates_set_owner
      BEFORE INSERT ON estimates
      FOR EACH ROW EXECUTE FUNCTION set_effective_user_id();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'invoices_set_owner') THEN
    CREATE TRIGGER invoices_set_owner
      BEFORE INSERT ON invoices
      FOR EACH ROW EXECUTE FUNCTION set_effective_user_id();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'jobs_set_owner') THEN
    CREATE TRIGGER jobs_set_owner
      BEFORE INSERT ON jobs
      FOR EACH ROW EXECUTE FUNCTION set_effective_user_id();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'documents_set_owner') THEN
    CREATE TRIGGER documents_set_owner
      BEFORE INSERT ON documents
      FOR EACH ROW EXECUTE FUNCTION set_effective_user_id();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'change_orders_set_owner') THEN
    CREATE TRIGGER change_orders_set_owner
      BEFORE INSERT ON change_orders
      FOR EACH ROW EXECUTE FUNCTION set_effective_user_id();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'clients_set_owner') THEN
    CREATE TRIGGER clients_set_owner
      BEFORE INSERT ON clients
      FOR EACH ROW EXECUTE FUNCTION set_effective_user_id();
  END IF;

END $$;


-- ── 4. Update RLS policies to use get_owner_id() ─────────────────────────
-- Drops any existing user-scoped policies and replaces with team-aware ones.
-- Adjust table names below if your app uses different policy names.

-- estimates
DROP POLICY IF EXISTS "users_own_estimates" ON estimates;
DROP POLICY IF EXISTS "Users can manage own estimates" ON estimates;
CREATE POLICY "team_estimates" ON estimates
  USING      (user_id = get_owner_id())
  WITH CHECK (user_id = get_owner_id());

-- invoices
DROP POLICY IF EXISTS "users_own_invoices" ON invoices;
DROP POLICY IF EXISTS "Users can manage own invoices" ON invoices;
CREATE POLICY "team_invoices" ON invoices
  USING      (user_id = get_owner_id())
  WITH CHECK (user_id = get_owner_id());

-- jobs
DROP POLICY IF EXISTS "users_own_jobs" ON jobs;
DROP POLICY IF EXISTS "Users can manage own jobs" ON jobs;
CREATE POLICY "team_jobs" ON jobs
  USING      (user_id = get_owner_id())
  WITH CHECK (user_id = get_owner_id());

-- documents
DROP POLICY IF EXISTS "users_own_documents" ON documents;
DROP POLICY IF EXISTS "Users can manage own documents" ON documents;
CREATE POLICY "team_documents" ON documents
  USING      (user_id = get_owner_id())
  WITH CHECK (user_id = get_owner_id());

-- change_orders
DROP POLICY IF EXISTS "users_own_change_orders" ON change_orders;
DROP POLICY IF EXISTS "Users can manage own change orders" ON change_orders;
CREATE POLICY "team_change_orders" ON change_orders
  USING      (user_id = get_owner_id())
  WITH CHECK (user_id = get_owner_id());

-- clients
DROP POLICY IF EXISTS "users_own_clients" ON clients;
DROP POLICY IF EXISTS "Users can manage own clients" ON clients;
CREATE POLICY "team_clients" ON clients
  USING      (user_id = get_owner_id())
  WITH CHECK (user_id = get_owner_id());

-- usage_events
DROP POLICY IF EXISTS "users_own_usage" ON usage_events;
DROP POLICY IF EXISTS "Users can manage own usage" ON usage_events;
CREATE POLICY "team_usage_events" ON usage_events
  USING      (user_id = get_owner_id())
  WITH CHECK (user_id = get_owner_id());

-- share_links (read-only for team members — writes go through service key in API)
DROP POLICY IF EXISTS "users_own_share_links" ON share_links;
DROP POLICY IF EXISTS "Users can manage own share links" ON share_links;
CREATE POLICY "team_share_links" ON share_links
  USING      (user_id = get_owner_id())
  WITH CHECK (user_id = get_owner_id());
