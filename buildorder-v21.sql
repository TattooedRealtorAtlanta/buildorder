-- v21: Job Costs table for tracking actual spend vs contract price

CREATE TABLE IF NOT EXISTS job_costs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
  category    TEXT NOT NULL DEFAULT 'other',
  logged_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE job_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_costs_all ON job_costs
  FOR ALL USING (user_id = get_owner_id())
  WITH CHECK (user_id = get_owner_id());

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'job_costs_set_user_id') THEN
    CREATE TRIGGER job_costs_set_user_id
      BEFORE INSERT ON job_costs
      FOR EACH ROW EXECUTE FUNCTION set_effective_user_id();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS job_costs_job_id_idx ON job_costs (job_id);
