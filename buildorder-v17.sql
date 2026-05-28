-- BuildOrder v17: Reminder Columns + Document Auto-Numbering
-- Run in Supabase SQL Editor

-- ── 1. Reminder tracking columns ─────────────────────────────────────────

-- Estimate expiry reminder (already referenced in cron-expiry.js)
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

-- Share link reminders
ALTER TABLE share_links
  ADD COLUMN IF NOT EXISTS sig_reminder_sent_at   TIMESTAMPTZ,  -- unsigned doc 3-day nudge
  ADD COLUMN IF NOT EXISTS payment_reminders_sent INT DEFAULT 0; -- payment reminder count


-- ── 2. Document counters table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doc_counters (
  user_id    UUID  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_type   TEXT  NOT NULL,
  last_number INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, doc_type)
);

ALTER TABLE doc_counters ENABLE ROW LEVEL SECURITY;
-- Accessed via service role only (triggers run SECURITY DEFINER)


-- ── 3. next_doc_number() helper ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION next_doc_number(p_user_id UUID, p_doc_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next   INT;
  v_prefix TEXT;
BEGIN
  INSERT INTO doc_counters (user_id, doc_type, last_number)
  VALUES (p_user_id, p_doc_type, 1)
  ON CONFLICT (user_id, doc_type)
  DO UPDATE SET last_number = doc_counters.last_number + 1
  RETURNING last_number INTO v_next;

  v_prefix := CASE p_doc_type
    WHEN 'estimate'     THEN 'EST'
    WHEN 'invoice'      THEN 'INV'
    WHEN 'change_order' THEN 'CO'
    WHEN 'job'          THEN 'CON'
    ELSE 'DOC'
  END;

  RETURN v_prefix || '-' || LPAD(v_next::text, 3, '0');
END;
$$;


-- ── 4. set_doc_number() trigger function ─────────────────────────────────
-- Uses get_owner_id() directly so team member inserts count under owner.
-- This is safe regardless of trigger firing order vs. set_effective_user_id().
CREATE OR REPLACE FUNCTION set_doc_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.doc_number IS NULL OR NEW.doc_number = '' THEN
    NEW.doc_number := next_doc_number(get_owner_id(), TG_ARGV[0]);
  END IF;
  RETURN NEW;
END;
$$;


-- ── 5. Add doc_number columns ────────────────────────────────────────────
ALTER TABLE estimates     ADD COLUMN IF NOT EXISTS doc_number TEXT;
ALTER TABLE invoices      ADD COLUMN IF NOT EXISTS doc_number TEXT;
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS doc_number TEXT;


-- ── 6. Attach triggers ───────────────────────────────────────────────────
DO $$ BEGIN

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'estimates_doc_number') THEN
    CREATE TRIGGER estimates_doc_number
      BEFORE INSERT ON estimates
      FOR EACH ROW EXECUTE FUNCTION set_doc_number('estimate');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'invoices_doc_number') THEN
    CREATE TRIGGER invoices_doc_number
      BEFORE INSERT ON invoices
      FOR EACH ROW EXECUTE FUNCTION set_doc_number('invoice');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'change_orders_doc_number') THEN
    CREATE TRIGGER change_orders_doc_number
      BEFORE INSERT ON change_orders
      FOR EACH ROW EXECUTE FUNCTION set_doc_number('change_order');
  END IF;

END $$;
