-- Funding bank account verification requests.
-- Provider-ready table for 1-won/account verification flow.

CREATE TABLE IF NOT EXISTS funding_bank_account_verifications (
  verification_id BIGSERIAL PRIMARY KEY,
  user_id BIGINT,
  bank_name VARCHAR(100) NOT NULL,
  account_number VARCHAR(100) NOT NULL,
  account_holder VARCHAR(100) NOT NULL,
  verification_code VARCHAR(30) NOT NULL,
  verification_token VARCHAR(255) UNIQUE,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_funding_bank_account_verifications_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_funding_bank_account_verifications_user_status
  ON funding_bank_account_verifications(user_id, status);

CREATE INDEX IF NOT EXISTS idx_funding_bank_account_verifications_expires_at
  ON funding_bank_account_verifications(expires_at);

CREATE INDEX IF NOT EXISTS idx_funding_bank_account_verifications_token
  ON funding_bank_account_verifications(verification_token);
