-- ============================================================
-- BuildOrder.ai v28 — Enforce Business-tier gate on Job Photo Log
-- Run in Supabase SQL Editor after buildorder-v27.sql
--
-- photos.html inserts into job_photos directly from the browser using the
-- user's own Supabase session, so an API-route check cannot gate it. The
-- enforcement has to live in RLS.
--
-- Deliberately asymmetric: SELECT / UPDATE / DELETE stay open on a user's
-- own rows so nobody is locked out of photos they already uploaded. Only
-- INSERT requires the Business plan.
--
-- Founding members resolve to Pro, not Business, so they are correctly
-- excluded while on the founding trial.
-- ============================================================

ALTER TABLE job_photos ENABLE ROW LEVEL SECURITY;

-- Replace the blanket FOR ALL policy from v4
DROP POLICY IF EXISTS "Users manage own job photos" ON job_photos;

DROP POLICY IF EXISTS "job_photos: read own"   ON job_photos;
DROP POLICY IF EXISTS "job_photos: update own" ON job_photos;
DROP POLICY IF EXISTS "job_photos: delete own" ON job_photos;
DROP POLICY IF EXISTS "job_photos: insert requires business" ON job_photos;

CREATE POLICY "job_photos: read own"
  ON job_photos FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "job_photos: update own"
  ON job_photos FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "job_photos: delete own"
  ON job_photos FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "job_photos: insert requires business"
  ON job_photos FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM contractor_profiles p
      WHERE p.id = auth.uid()
        AND p.plan = 'business'
    )
  );

-- Note: API routes use the service-role key and bypass RLS entirely,
-- so server-side inserts are unaffected by the policy above.
