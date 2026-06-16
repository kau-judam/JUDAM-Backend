ALTER TABLE funding_drafts
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;

ALTER TABLE funding_drafts
ADD COLUMN IF NOT EXISTS reviewed_by BIGINT REFERENCES users(user_id);
