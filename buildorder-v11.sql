-- ============================================================
-- BuildOrder.ai v11 — Payment Reminders, Job Status, Notes
-- Run in Supabase SQL Editor after buildorder-v10.sql
-- ============================================================

-- Track how many payment reminder emails have been sent per share link
ALTER TABLE share_links
  ADD COLUMN IF NOT EXISTS payment_reminders_sent SMALLINT DEFAULT 0;

-- Job progress status (separate from doc-generation status)
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS job_status TEXT DEFAULT 'in_progress';

-- Private internal notes (never shown to clients)
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS notes TEXT;
