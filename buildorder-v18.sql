-- BuildOrder v18: Contractor Logo
-- Run in Supabase SQL Editor

ALTER TABLE contractor_profiles
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- NOTE: After running this SQL, go to Supabase Dashboard → Storage → New bucket
-- Name: logos | Public bucket: YES
-- That's all — the upload API uses the service key and handles permissions.
