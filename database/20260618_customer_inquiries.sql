CREATE TABLE IF NOT EXISTS customer_inquiries (
  inquiry_id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NULL,
  account_email VARCHAR(255) NULL,
  reply_email VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'ETC',
  subject VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'RECEIVED',
  mail_sent BOOLEAN NOT NULL DEFAULT FALSE,
  mail_error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_inquiries_user_id
  ON customer_inquiries(user_id);

CREATE INDEX IF NOT EXISTS idx_customer_inquiries_created_at
  ON customer_inquiries(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_inquiries_status
  ON customer_inquiries(status);
