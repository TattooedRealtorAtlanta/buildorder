-- BuildOrder v19: Proposals table (combined estimate + contract)

CREATE TABLE IF NOT EXISTS proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  homeowner_name  TEXT,
  homeowner_email TEXT,
  homeowner_phone TEXT,
  job_address     TEXT,
  job_city        TEXT,
  job_state       TEXT,
  work_type       TEXT,
  description     TEXT,
  deposit_pct     INT DEFAULT 50,
  net_days        INT DEFAULT 30,
  total           NUMERIC(10,2),
  content         TEXT,
  status          TEXT DEFAULT 'draft',
  doc_number      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY proposals_all ON proposals
  FOR ALL USING (user_id = get_owner_id());

-- Auto-set user_id to owner's id (team member support)
CREATE TRIGGER proposals_set_user_id
  BEFORE INSERT ON proposals
  FOR EACH ROW EXECUTE FUNCTION set_effective_user_id();

-- Auto-assign PROP-001 doc number
CREATE TRIGGER proposals_doc_number
  BEFORE INSERT ON proposals
  FOR EACH ROW EXECUTE FUNCTION set_doc_number('PROP');
