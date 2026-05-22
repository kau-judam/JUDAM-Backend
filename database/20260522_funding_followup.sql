-- Funding follow-up fixes for draft/public linkage, reviews, and stats.
-- Safe to run multiple times.

ALTER TABLE funding_drafts
  ADD COLUMN IF NOT EXISTS funding_id BIGINT;

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

ALTER TABLE funding_reviews
  ADD COLUMN IF NOT EXISTS mood TEXT,
  ADD COLUMN IF NOT EXISTS pairing TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT,
  ADD COLUMN IF NOT EXISTS record_visibility BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

ALTER TABLE funding_reviews
  ALTER COLUMN title DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_funding_drafts_funding_id
  ON funding_drafts(funding_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_funding_reviews_funding_user_idx
  ON funding_reviews(funding_id, user_id)
  WHERE user_id IS NOT NULL;
