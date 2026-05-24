-- ============================================================
-- BuildOrder.ai — Supabase Schema
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Contractor profiles (one per user account)
CREATE TABLE contractor_profiles (
  id uuid references auth.users primary key,
  business_name text,
  contractor_name text not null,
  address text,
  city text,
  state text,
  zip text,
  phone text,
  email text,
  license_number text,
  license_type text,
  gl_provider text,
  gl_status text default 'Active',
  bond_info text,
  logo_url text,
  plan text default 'free',
  onboarding_complete boolean default false,
  created_at timestamptz default now()
);

-- Jobs (one per project)
CREATE TABLE jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references contractor_profiles(id) on delete cascade not null,

  -- Homeowner
  homeowner_name text,
  homeowner_address text,
  homeowner_city text,
  homeowner_state text,
  homeowner_zip text,
  homeowner_phone text,
  homeowner_email text,

  -- Job location
  job_address text,
  job_city text,
  job_county text,
  job_state text,
  job_zip text,

  -- Job details
  project_description text,
  work_type text,
  contract_price numeric,
  payment_schedule text,
  deposit_amount numeric,
  start_date date,
  estimated_completion_date date,
  is_primary_residence boolean default true,

  -- Status
  status text default 'active',
  created_at timestamptz default now()
);

-- Generated documents
CREATE TABLE documents (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade not null,
  user_id uuid references contractor_profiles(id) on delete cascade not null,
  doc_type text not null, -- contract, estimate, invoice, change_order, lien_waiver, sub_agreement
  content text,
  created_at timestamptz default now()
);

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE contractor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their profile"
  ON contractor_profiles FOR ALL
  USING (auth.uid() = id);

CREATE POLICY "Users own their jobs"
  ON jobs FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users own their documents"
  ON documents FOR ALL
  USING (auth.uid() = user_id);
