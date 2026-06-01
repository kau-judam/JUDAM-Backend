-- Password reset verification codes are stored as hashes only.
-- Safe to run repeatedly on existing RDS databases.

CREATE TABLE IF NOT EXISTS password_reset_verifications (
  verification_id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  verification_code_hash TEXT,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  attempt_count INT NOT NULL DEFAULT 0,
  reset_token_hash TEXT,
  reset_token_expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at TIMESTAMP
);

ALTER TABLE IF EXISTS password_reset_verifications
ADD COLUMN IF NOT EXISTS verification_code_hash TEXT,
ADD COLUMN IF NOT EXISTS used BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS reset_token_hash TEXT,
ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS used_at TIMESTAMP;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'password_reset_verifications'
      AND column_name = 'code'
  ) THEN
    ALTER TABLE password_reset_verifications
    ALTER COLUMN code DROP NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_password_reset_verifications_email
ON password_reset_verifications(email);

CREATE INDEX IF NOT EXISTS idx_password_reset_verifications_email_created
ON password_reset_verifications(email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_password_reset_verifications_expires_at
ON password_reset_verifications(expires_at);

CREATE INDEX IF NOT EXISTS idx_password_reset_verifications_reset_token_hash
ON password_reset_verifications(reset_token_hash)
WHERE reset_token_hash IS NOT NULL;
