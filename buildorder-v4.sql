-- ============================================================
-- BuildOrder.ai v4 — Job Photo Log
-- Run in Supabase SQL Editor after buildorder-v3.sql
-- ============================================================

-- 1. Create storage bucket (public read)
INSERT INTO storage.buckets (id, name, public)
VALUES ('job-photos', 'job-photos', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Storage RLS policies
CREATE POLICY "Auth users can upload job photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'job-photos');

CREATE POLICY "Auth users can update own job photos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'job-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Auth users can delete own job photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'job-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- 3. Job photos metadata table
CREATE TABLE IF NOT EXISTS job_photos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id       UUID REFERENCES jobs(id) ON DELETE SET NULL,
  storage_path TEXT NOT NULL,
  public_url   TEXT NOT NULL,
  caption      TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE job_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own job photos" ON job_photos
  FOR ALL USING (auth.uid() = user_id);
