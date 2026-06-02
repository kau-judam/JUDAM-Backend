-- Demo funding flow safety fixes.
-- Safe to run repeatedly on existing RDS databases.

ALTER TABLE funding_drafts
  ADD COLUMN IF NOT EXISTS funding_id BIGINT,
  ADD COLUMN IF NOT EXISTS image_urls TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS raw_materials TEXT,
  ADD COLUMN IF NOT EXISTS flavor_notes TEXT,
  ADD COLUMN IF NOT EXISTS budget_plan TEXT,
  ADD COLUMN IF NOT EXISTS schedule_plan TEXT,
  ADD COLUMN IF NOT EXISTS creator_introduction TEXT,
  ADD COLUMN IF NOT EXISTS business_address_detail VARCHAR(255),
  ADD COLUMN IF NOT EXISTS bank_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS account_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS account_holder VARCHAR(100),
  ADD COLUMN IF NOT EXISTS account_verified BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_funding_drafts_funding'
  ) THEN
    ALTER TABLE funding_drafts
      ADD CONSTRAINT fk_funding_drafts_funding
      FOREIGN KEY (funding_id)
      REFERENCES funding_projects(funding_id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_funding_drafts_funding_id
  ON funding_drafts(funding_id);

CREATE INDEX IF NOT EXISTS idx_funding_drafts_brewery_funding
  ON funding_drafts(brewery_id, funding_id);

ALTER TABLE funding_reviews
  ADD COLUMN IF NOT EXISTS mood TEXT,
  ADD COLUMN IF NOT EXISTS pairing TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT,
  ADD COLUMN IF NOT EXISTS record_visibility BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

ALTER TABLE funding_reviews
  ALTER COLUMN rating TYPE NUMERIC(2,1)
  USING rating::numeric;

CREATE INDEX IF NOT EXISTS idx_funding_reviews_funding_id
  ON funding_reviews(funding_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_funding_reviews_funding_user_idx
  ON funding_reviews(funding_id, user_id)
  WHERE user_id IS NOT NULL;
