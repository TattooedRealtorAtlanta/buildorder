-- ============================================================
-- BuildOrder.ai v25 — Document Signatures & Audit Trail
-- Run in Supabase SQL Editor after buildorder-v24.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS document_signatures (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     TEXT        NOT NULL,           -- share_links.token
  contractor_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signature_image TEXT,                           -- base64 data URL
  ip_address      TEXT,
  user_agent      TEXT,
  signed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  audit_log       JSONB       NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_doc_sigs_document_id   ON document_signatures(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_sigs_contractor_id ON document_signatures(contractor_id);

ALTER TABLE document_signatures ENABLE ROW LEVEL SECURITY;

-- Service-role key (API routes) bypasses RLS.
-- Direct Supabase client access is read-only to the owning contractor.
CREATE POLICY "doc_sigs: contractor can read own"
  ON document_signatures FOR SELECT
  USING (auth.uid() = contractor_id);
