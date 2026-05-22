-- Funding project creation, review, support, and community flow.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS funding_drafts (
  draft_id BIGSERIAL PRIMARY KEY,
  brewery_id BIGINT NOT NULL,
  recipe_id BIGINT,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  progress_rate INT NOT NULL DEFAULT 0,
  reject_reason TEXT,
  submitted_at TIMESTAMP,

  is_adult_confirmed BOOLEAN NOT NULL DEFAULT false,
  is_contact_info_agreed BOOLEAN NOT NULL DEFAULT false,
  is_settlement_info_agreed BOOLEAN NOT NULL DEFAULT false,
  is_fee_policy_agreed BOOLEAN NOT NULL DEFAULT false,
  is_responsibility_agreed BOOLEAN NOT NULL DEFAULT false,
  is_license_agreed BOOLEAN NOT NULL DEFAULT false,
  is_ip_policy_agreed BOOLEAN NOT NULL DEFAULT false,
  all_required_terms_agreed BOOLEAN NOT NULL DEFAULT false,

  title VARCHAR(200),
  short_title VARCHAR(100),
  category VARCHAR(100),
  main_ingredient VARCHAR(255),
  sub_ingredients TEXT,
  alcohol_percentage DECIMAL(4,1),
  summary TEXT,
  thumbnail_url TEXT,
  image_urls TEXT,
  tags TEXT,

  price_per_bottle INT,
  total_quantity INT,
  target_amount INT,
  funding_start_date DATE,
  funding_period_days INT,
  funding_end_date DATE,
  expected_delivery_date DATE,
  platform_fee_rate DECIMAL(5,2),
  platform_fee_amount INT,
  shipping_fee INT,

  product_type VARCHAR(100),
  volume INT,
  raw_materials TEXT,

  sweetness INT,
  acidity INT,
  body INT,
  carbonation INT,
  alcohol_intensity INT,
  flavor_notes TEXT,

  introduction TEXT,
  video_url TEXT,
  budget_plan TEXT,
  schedule_plan TEXT,

  brewery_name VARCHAR(100),
  creator_name VARCHAR(100),
  profile_image_url TEXT,
  creator_introduction TEXT,
  representative_name VARCHAR(100),
  business_registration_number VARCHAR(30),
  business_address VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(30),
  bank_name VARCHAR(100),
  account_number VARCHAR(100),
  account_holder VARCHAR(100),
  business_type VARCHAR(100),
  business_name VARCHAR(100),
  business_category VARCHAR(100),
  business_item VARCHAR(100),
  tax_email VARCHAR(255),
  phone_verified BOOLEAN NOT NULL DEFAULT false,
  account_verified BOOLEAN NOT NULL DEFAULT false,
  identity_document_url TEXT,
  business_registration_file_url TEXT,

  refund_policy TEXT,
  exchange_policy TEXT,
  adult_verification_notice TEXT,
  risk_notice TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE funding_drafts
  ADD COLUMN IF NOT EXISTS brewery_id BIGINT,
  ADD COLUMN IF NOT EXISTS recipe_id BIGINT,
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS progress_rate INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reject_reason TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS is_adult_confirmed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_contact_info_agreed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_settlement_info_agreed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_fee_policy_agreed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_responsibility_agreed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_license_agreed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_ip_policy_agreed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS all_required_terms_agreed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS title VARCHAR(200),
  ADD COLUMN IF NOT EXISTS short_title VARCHAR(100),
  ADD COLUMN IF NOT EXISTS category VARCHAR(100),
  ADD COLUMN IF NOT EXISTS main_ingredient VARCHAR(255),
  ADD COLUMN IF NOT EXISTS sub_ingredients TEXT,
  ADD COLUMN IF NOT EXISTS alcohol_percentage DECIMAL(4,1),
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS image_urls TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT,
  ADD COLUMN IF NOT EXISTS price_per_bottle INT,
  ADD COLUMN IF NOT EXISTS total_quantity INT,
  ADD COLUMN IF NOT EXISTS target_amount INT,
  ADD COLUMN IF NOT EXISTS funding_start_date DATE,
  ADD COLUMN IF NOT EXISTS funding_period_days INT,
  ADD COLUMN IF NOT EXISTS funding_end_date DATE,
  ADD COLUMN IF NOT EXISTS expected_delivery_date DATE,
  ADD COLUMN IF NOT EXISTS platform_fee_rate DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS platform_fee_amount INT,
  ADD COLUMN IF NOT EXISTS shipping_fee INT,
  ADD COLUMN IF NOT EXISTS product_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS volume INT,
  ADD COLUMN IF NOT EXISTS raw_materials TEXT,
  ADD COLUMN IF NOT EXISTS sweetness INT,
  ADD COLUMN IF NOT EXISTS acidity INT,
  ADD COLUMN IF NOT EXISTS body INT,
  ADD COLUMN IF NOT EXISTS carbonation INT,
  ADD COLUMN IF NOT EXISTS alcohol_intensity INT,
  ADD COLUMN IF NOT EXISTS flavor_notes TEXT,
  ADD COLUMN IF NOT EXISTS introduction TEXT,
  ADD COLUMN IF NOT EXISTS video_url TEXT,
  ADD COLUMN IF NOT EXISTS budget_plan TEXT,
  ADD COLUMN IF NOT EXISTS schedule_plan TEXT,
  ADD COLUMN IF NOT EXISTS brewery_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS creator_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS profile_image_url TEXT,
  ADD COLUMN IF NOT EXISTS creator_introduction TEXT,
  ADD COLUMN IF NOT EXISTS representative_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS business_registration_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS business_address VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(30),
  ADD COLUMN IF NOT EXISTS bank_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS account_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS account_holder VARCHAR(100),
  ADD COLUMN IF NOT EXISTS business_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS business_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS business_category VARCHAR(100),
  ADD COLUMN IF NOT EXISTS business_item VARCHAR(100),
  ADD COLUMN IF NOT EXISTS tax_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS account_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS identity_document_url TEXT,
  ADD COLUMN IF NOT EXISTS business_registration_file_url TEXT,
  ADD COLUMN IF NOT EXISTS refund_policy TEXT,
  ADD COLUMN IF NOT EXISTS exchange_policy TEXT,
  ADD COLUMN IF NOT EXISTS adult_verification_notice TEXT,
  ADD COLUMN IF NOT EXISTS risk_notice TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS funding_documents (
  document_id BIGSERIAL PRIMARY KEY,
  draft_id BIGINT NOT NULL,
  document_type VARCHAR(50) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  mime_type VARCHAR(100),
  file_size BIGINT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_funding_documents_draft
    FOREIGN KEY (draft_id)
    REFERENCES funding_drafts(draft_id)
    ON DELETE CASCADE
);

ALTER TABLE funding_documents
  ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS file_size BIGINT;

ALTER TABLE funding_projects
  ADD COLUMN IF NOT EXISTS short_title VARCHAR(100),
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS category VARCHAR(100),
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS image_urls TEXT,
  ADD COLUMN IF NOT EXISTS expected_delivery_date DATE,
  ADD COLUMN IF NOT EXISTS price_per_bottle INT,
  ADD COLUMN IF NOT EXISTS shipping_fee INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS volume INT,
  ADD COLUMN IF NOT EXISTS alcohol_percentage DECIMAL(4,1),
  ADD COLUMN IF NOT EXISTS bottle_size VARCHAR(50),
  ADD COLUMN IF NOT EXISTS supporter_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS like_count INT NOT NULL DEFAULT 0;

ALTER TABLE funding_support_options
  ADD COLUMN IF NOT EXISTS volume VARCHAR(50),
  ADD COLUMN IF NOT EXISTS alcohol VARCHAR(50),
  ADD COLUMN IF NOT EXISTS alcohol_percentage DECIMAL(4,1);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS price_per_bottle INT,
  ADD COLUMN IF NOT EXISTS shipping_fee INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS donation_amount INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additional_support_amount INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supporter_phone VARCHAR(30),
  ADD COLUMN IF NOT EXISTS supporter_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS support_message TEXT,
  ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS privacy_agreed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS privacy_third_party_agreed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS terms_agreed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refund_policy_agreed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_key VARCHAR(255),
  ADD COLUMN IF NOT EXISTS checkout_url TEXT;

CREATE TABLE IF NOT EXISTS funding_likes (
  like_id BIGSERIAL PRIMARY KEY,
  funding_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_funding_likes_funding
    FOREIGN KEY (funding_id)
    REFERENCES funding_projects(funding_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_funding_likes_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE,
  CONSTRAINT uq_funding_likes_user_funding
    UNIQUE (user_id, funding_id)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = 'brewery_logs'
      AND tableowner = CURRENT_USER
  ) THEN
    ALTER TABLE brewery_logs
      ADD COLUMN IF NOT EXISTS video_url TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
  ELSE
    RAISE NOTICE 'Skipping brewery_logs ALTER because current user is not the table owner.';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS brewery_log_likes (
  like_id BIGSERIAL PRIMARY KEY,
  brewery_log_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_brewery_log_likes_log
    FOREIGN KEY (brewery_log_id)
    REFERENCES brewery_logs(log_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_brewery_log_likes_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE,
  CONSTRAINT uq_brewery_log_likes_log_user
    UNIQUE (brewery_log_id, user_id)
);

CREATE TABLE IF NOT EXISTS brewery_log_comments (
  comment_id BIGSERIAL PRIMARY KEY,
  brewery_log_id BIGINT NOT NULL,
  user_id BIGINT,
  parent_comment_id BIGINT,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP,
  CONSTRAINT fk_brewery_log_comments_log
    FOREIGN KEY (brewery_log_id)
    REFERENCES brewery_logs(log_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_brewery_log_comments_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_brewery_log_comments_parent
    FOREIGN KEY (parent_comment_id)
    REFERENCES brewery_log_comments(comment_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS brewery_log_comment_likes (
  like_id BIGSERIAL PRIMARY KEY,
  comment_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_brewery_log_comment_likes_comment
    FOREIGN KEY (comment_id)
    REFERENCES brewery_log_comments(comment_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_brewery_log_comment_likes_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE,
  CONSTRAINT uq_brewery_log_comment_likes_comment_user
    UNIQUE (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS funding_questions (
  question_id BIGSERIAL PRIMARY KEY,
  funding_id BIGINT NOT NULL,
  user_id BIGINT,
  title VARCHAR(200),
  content TEXT NOT NULL,
  is_private BOOLEAN NOT NULL DEFAULT false,
  answered BOOLEAN NOT NULL DEFAULT false,
  like_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_funding_questions_funding
    FOREIGN KEY (funding_id)
    REFERENCES funding_projects(funding_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_funding_questions_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS funding_question_replies (
  reply_id BIGSERIAL PRIMARY KEY,
  question_id BIGINT NOT NULL,
  funding_id BIGINT NOT NULL,
  user_id BIGINT,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_funding_question_replies_question
    FOREIGN KEY (question_id)
    REFERENCES funding_questions(question_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_funding_question_replies_funding
    FOREIGN KEY (funding_id)
    REFERENCES funding_projects(funding_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_funding_question_replies_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS funding_question_likes (
  like_id BIGSERIAL PRIMARY KEY,
  question_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_funding_question_likes_question
    FOREIGN KEY (question_id)
    REFERENCES funding_questions(question_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_funding_question_likes_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE,
  CONSTRAINT uq_funding_question_likes_question_user
    UNIQUE (question_id, user_id)
);

CREATE TABLE IF NOT EXISTS funding_reviews (
  review_id BIGSERIAL PRIMARY KEY,
  funding_id BIGINT NOT NULL,
  order_id BIGINT,
  user_id BIGINT,
  rating DECIMAL(2,1) NOT NULL,
  title VARCHAR(200),
  content TEXT NOT NULL,
  image_urls TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP,
  CONSTRAINT fk_funding_reviews_funding
    FOREIGN KEY (funding_id)
    REFERENCES funding_projects(funding_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_funding_reviews_order
    FOREIGN KEY (order_id)
    REFERENCES orders(order_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_funding_reviews_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS funding_reports (
  report_id BIGSERIAL PRIMARY KEY,
  funding_id BIGINT NOT NULL,
  reporter_id BIGINT,
  reason VARCHAR(50) NOT NULL,
  content TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_funding_reports_funding
    FOREIGN KEY (funding_id)
    REFERENCES funding_projects(funding_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_funding_reports_reporter
    FOREIGN KEY (reporter_id)
    REFERENCES users(user_id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS funding_shares (
  share_id BIGSERIAL PRIMARY KEY,
  funding_id BIGINT NOT NULL UNIQUE,
  share_url TEXT,
  share_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_funding_shares_funding
    FOREIGN KEY (funding_id)
    REFERENCES funding_projects(funding_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_funding_drafts_brewery_id ON funding_drafts(brewery_id);
CREATE INDEX IF NOT EXISTS idx_funding_documents_draft_id ON funding_documents(draft_id);
CREATE INDEX IF NOT EXISTS idx_funding_likes_user_id ON funding_likes(user_id);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = 'brewery_logs'
      AND tableowner = CURRENT_USER
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_brewery_logs_funding_id ON brewery_logs(funding_id);
  ELSE
    RAISE NOTICE 'Skipping brewery_logs index because current user is not the table owner.';
  END IF;
END
$$;
CREATE INDEX IF NOT EXISTS idx_funding_questions_funding_id ON funding_questions(funding_id);
CREATE INDEX IF NOT EXISTS idx_funding_reviews_funding_id ON funding_reviews(funding_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_funding_likes_user_funding_idx
  ON funding_likes(user_id, funding_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_brewery_log_likes_log_user_idx
  ON brewery_log_likes(brewery_log_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_brewery_log_comment_likes_comment_user_idx
  ON brewery_log_comment_likes(comment_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_funding_question_likes_question_user_idx
  ON funding_question_likes(question_id, user_id);
