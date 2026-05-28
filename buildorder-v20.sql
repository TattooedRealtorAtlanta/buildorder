-- BuildOrder v20: Labor rate + markup % on contractor profiles (Rate Library AI injection)

ALTER TABLE contractor_profiles
  ADD COLUMN IF NOT EXISTS labor_rate   NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS markup_pct   INT DEFAULT 20;
