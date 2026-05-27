-- Authentication and member initial table creation schema.

CREATE TABLE IF NOT EXISTS users (
  user_id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255),
  password VARCHAR(255),
  nickname VARCHAR(100),
  phone_number VARCHAR(30),
  role VARCHAR(20) NOT NULL DEFAULT 'USER',
  provider VARCHAR(20) NOT NULL DEFAULT 'kakao',
  kakao_id BIGINT UNIQUE,
  profile_image TEXT,
  terms_agreed BOOLEAN NOT NULL DEFAULT false,
  privacy_agreed BOOLEAN NOT NULL DEFAULT false,
  marketing_agreed BOOLEAN NOT NULL DEFAULT false,
  terms_agreed_at TIMESTAMP,
  privacy_agreed_at TIMESTAMP,
  marketing_agreed_at TIMESTAMP,
  taste_vector JSONB,
  bti_code VARCHAR(20),
  character_name VARCHAR(100),
  alcohol_label VARCHAR(100),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP,
  deleted_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  refresh_token_id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  token TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP,
  CONSTRAINT fk_refresh_tokens_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS password_reset_verifications (
  verification_id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  code VARCHAR(10) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  verified_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_reset_verifications_email
ON password_reset_verifications(email);

CREATE INDEX IF NOT EXISTS idx_password_reset_verifications_expires_at
ON password_reset_verifications(expires_at);

CREATE TABLE IF NOT EXISTS auth_phone_verifications (
  verification_id BIGSERIAL PRIMARY KEY,
  phone_number VARCHAR(30) NOT NULL,
  code VARCHAR(30) NOT NULL,
  verification_token VARCHAR(255),
  expires_at TIMESTAMP NOT NULL,
  verified_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_phone_verifications_phone
ON auth_phone_verifications(phone_number);

CREATE INDEX IF NOT EXISTS idx_auth_phone_verifications_token
ON auth_phone_verifications(verification_token);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id BIGINT NOT NULL,
  badge_id VARCHAR(50) NOT NULL,
  earned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, badge_id),
  CONSTRAINT fk_user_badges_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS posts (
  post_id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  like_count INT NOT NULL DEFAULT 0,
  comment_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_posts_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS post_comments (
  comment_id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  content TEXT NOT NULL,
  like_count INT NOT NULL DEFAULT 0,
  parent_comment_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP,
  CONSTRAINT fk_post_comments_post
    FOREIGN KEY (post_id)
    REFERENCES posts(post_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_post_comments_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_post_comments_parent
    FOREIGN KEY (parent_comment_id)
    REFERENCES post_comments(comment_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS post_images (
  image_id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL,
  image_url TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_post_images_post
    FOREIGN KEY (post_id)
    REFERENCES posts(post_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS post_likes (
  like_id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_post_likes_post
    FOREIGN KEY (post_id)
    REFERENCES posts(post_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_post_likes_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE,
  CONSTRAINT uq_post_likes_post_user
    UNIQUE (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_comment_likes (
  like_id BIGSERIAL PRIMARY KEY,
  comment_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_post_comment_likes_comment
    FOREIGN KEY (comment_id)
    REFERENCES post_comments(comment_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_post_comment_likes_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE,
  CONSTRAINT uq_post_comment_likes_comment_user
    UNIQUE (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS recipes (
  recipe_id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  abv_range VARCHAR(50),
  main_ingredient VARCHAR(255),
  ai_sub_ingredient TEXT,
  target_flavor VARCHAR(255),
  concept TEXT,
  summary TEXT,
  author_type VARCHAR(30) NOT NULL DEFAULT 'CONSUMER',
  status VARCHAR(30) NOT NULL DEFAULT 'PUBLISHED',
  is_fundable BOOLEAN NOT NULL DEFAULT false,
  interest_count INT NOT NULL DEFAULT 0,
  image_url TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_recipes_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recipe_comments (
  comment_id BIGSERIAL PRIMARY KEY,
  recipe_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  content TEXT NOT NULL,
  like_count INT NOT NULL DEFAULT 0,
  parent_comment_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP,
  CONSTRAINT fk_recipe_comments_recipe
    FOREIGN KEY (recipe_id)
    REFERENCES recipes(recipe_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_recipe_comments_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_recipe_comments_parent
    FOREIGN KEY (parent_comment_id)
    REFERENCES recipe_comments(comment_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recipe_comment_likes (
  like_id BIGSERIAL PRIMARY KEY,
  comment_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_recipe_comment_likes_comment
    FOREIGN KEY (comment_id)
    REFERENCES recipe_comments(comment_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_recipe_comment_likes_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE,
  CONSTRAINT uq_recipe_comment_likes_comment_user
    UNIQUE (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS recipe_interests (
  interest_id BIGSERIAL PRIMARY KEY,
  recipe_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_recipe_interests_recipe
    FOREIGN KEY (recipe_id)
    REFERENCES recipes(recipe_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_recipe_interests_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE,
  CONSTRAINT uq_recipe_interests_recipe_user
    UNIQUE (recipe_id, user_id)
);

CREATE TABLE IF NOT EXISTS funding_projects (
  funding_id BIGSERIAL PRIMARY KEY,
  recipe_id BIGINT NOT NULL,
  brewery_user_id BIGINT NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  goal_amount INT NOT NULL,
  current_amount INT NOT NULL DEFAULT 0,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'READY',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_funding_projects_recipe
    FOREIGN KEY (recipe_id)
    REFERENCES recipes(recipe_id),
  CONSTRAINT fk_funding_projects_brewery_user
    FOREIGN KEY (brewery_user_id)
    REFERENCES users(user_id)
);

-- Funding draft/public project linkage used by GET /api/fundings/drafts/by-funding/:fundingId.
-- The actual funding_drafts table is managed by the funding draft migration; keep this
-- additive statement here so existing RDS tables can be safely patched.
ALTER TABLE IF EXISTS funding_drafts
ADD COLUMN IF NOT EXISTS funding_id BIGINT
  REFERENCES funding_projects(funding_id)
  ON DELETE SET NULL;

-- Funding management screens depend on these fields being stored as user-entered
-- values. RDS schema changes are applied manually, so these additive statements are
-- kept as a reference for data-integrity backfills/migrations.
ALTER TABLE IF EXISTS funding_projects
ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
ADD COLUMN IF NOT EXISTS image_urls TEXT,
ADD COLUMN IF NOT EXISTS summary TEXT,
ADD COLUMN IF NOT EXISTS category VARCHAR(100),
ADD COLUMN IF NOT EXISTS expected_delivery_date DATE,
ADD COLUMN IF NOT EXISTS price_per_bottle INT,
ADD COLUMN IF NOT EXISTS shipping_fee INT,
ADD COLUMN IF NOT EXISTS volume INT,
ADD COLUMN IF NOT EXISTS alcohol_percentage DECIMAL(4,1),
ADD COLUMN IF NOT EXISTS bottle_size VARCHAR(50),
ADD COLUMN IF NOT EXISTS short_title VARCHAR(100),
ADD COLUMN IF NOT EXISTS budget_plan TEXT,
ADD COLUMN IF NOT EXISTS schedule_plan TEXT,
ADD COLUMN IF NOT EXISTS refund_policy TEXT,
ADD COLUMN IF NOT EXISTS exchange_policy TEXT,
ADD COLUMN IF NOT EXISTS creator_introduction TEXT;

ALTER TABLE IF EXISTS funding_drafts
ADD COLUMN IF NOT EXISTS image_urls TEXT,
ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
ADD COLUMN IF NOT EXISTS flavor_notes TEXT,
ADD COLUMN IF NOT EXISTS budget_plan TEXT,
ADD COLUMN IF NOT EXISTS schedule_plan TEXT,
ADD COLUMN IF NOT EXISTS creator_introduction TEXT,
ADD COLUMN IF NOT EXISTS business_address_detail VARCHAR(255);

-- Existing data backfill reference. Review candidates before running an UPDATE in RDS.
-- SELECT
--   fp.funding_id,
--   fp.title AS funding_title,
--   fp.brewery_user_id,
--   fd.draft_id,
--   fd.title AS draft_title,
--   fd.status,
--   fd.submitted_at,
--   fd.created_at
-- FROM funding_projects fp
-- JOIN funding_drafts fd
--   ON fd.funding_id IS NULL
--   AND NULLIF(BTRIM(fd.title), '') = NULLIF(BTRIM(fp.title), '')
--   AND (fd.brewery_id IS NULL OR fd.brewery_id = fp.brewery_user_id)
-- ORDER BY fp.funding_id, ABS(EXTRACT(EPOCH FROM (
--   COALESCE(fd.submitted_at, fd.updated_at, fd.created_at) - fp.created_at
-- )));

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

CREATE TABLE IF NOT EXISTS funding_support_options (
  option_id BIGSERIAL PRIMARY KEY,
  funding_id BIGINT NOT NULL,
  name VARCHAR(100) NOT NULL,
  price INT NOT NULL,
  description TEXT,
  stock INT,
  remaining_stock INT,
  max_per_user INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_funding_support_options_funding
    FOREIGN KEY (funding_id)
    REFERENCES funding_projects(funding_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS orders (
  order_id BIGSERIAL PRIMARY KEY,
  user_id BIGINT,
  funding_id BIGINT,
  option_id BIGINT,
  quantity INT NOT NULL DEFAULT 1,
  total_amount INT NOT NULL,
  order_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  recipient_name VARCHAR(100),
  recipient_phone VARCHAR(30),
  shipping_address VARCHAR(255),
  shipping_detail_address VARCHAR(255),
  adult_verified BOOLEAN NOT NULL DEFAULT false,
  notice_agreed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_orders_funding
    FOREIGN KEY (funding_id)
    REFERENCES funding_projects(funding_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_orders_option
    FOREIGN KEY (option_id)
    REFERENCES funding_support_options(option_id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payments (
  payment_id BIGSERIAL PRIMARY KEY,
  order_id BIGINT,
  payment_method VARCHAR(50),
  payment_provider VARCHAR(50),
  amount INT NOT NULL,
  payment_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  payment_url TEXT,
  paid_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payments_order
    FOREIGN KEY (order_id)
    REFERENCES orders(order_id)
    ON DELETE SET NULL
);

ALTER TABLE IF EXISTS funding_projects
ADD COLUMN IF NOT EXISTS supporter_count INT NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS orders
ADD COLUMN IF NOT EXISTS price_per_bottle INT,
ADD COLUMN IF NOT EXISTS shipping_fee INT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS donation_amount INT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS additional_support_amount INT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS supporter_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS support_message TEXT,
ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20),
ADD COLUMN IF NOT EXISTS privacy_agreed BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS privacy_third_party_agreed BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS terms_agreed BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS refund_policy_agreed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS payments
ADD COLUMN IF NOT EXISTS payment_key VARCHAR(255),
ADD COLUMN IF NOT EXISTS checkout_url TEXT;

CREATE TABLE IF NOT EXISTS brewery_auth (
  application_id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  license_number VARCHAR(100) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  location VARCHAR(255),
  brewery_name VARCHAR(100),
  business_address_detail VARCHAR(255),
  phone_number VARCHAR(30),
  document_url TEXT,
  document_key TEXT,
  original_name VARCHAR(255),
  mime_type VARCHAR(100),
  file_size BIGINT,
  reject_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_brewery_auth_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS brewery_logs (
  log_id BIGSERIAL PRIMARY KEY,
  funding_id BIGINT NOT NULL,
  step VARCHAR(50),
  title VARCHAR(200),
  content TEXT,
  image_urls TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_brewery_logs_funding
    FOREIGN KEY (funding_id)
    REFERENCES funding_projects(funding_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS questions (
  question_id BIGSERIAL PRIMARY KEY,
  funding_id BIGINT,
  user_id BIGINT,
  title VARCHAR(200),
  content TEXT,
  is_private BOOLEAN NOT NULL DEFAULT false,
  answered BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_questions_funding
    FOREIGN KEY (funding_id)
    REFERENCES funding_projects(funding_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_questions_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS question_replies (
  reply_id BIGSERIAL PRIMARY KEY,
  question_id BIGINT NOT NULL,
  user_id BIGINT,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_question_replies_question
    FOREIGN KEY (question_id)
    REFERENCES questions(question_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_question_replies_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inquiries (
  inquiry_id BIGSERIAL PRIMARY KEY,
  funding_id BIGINT,
  user_id BIGINT,
  title VARCHAR(200),
  content TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_inquiries_funding
    FOREIGN KEY (funding_id)
    REFERENCES funding_projects(funding_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_inquiries_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  review_id BIGSERIAL PRIMARY KEY,
  funding_id BIGINT,
  user_id BIGINT,
  order_id BIGINT,
  rating DECIMAL(2,1),
  content TEXT,
  image_urls TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reviews_funding
    FOREIGN KEY (funding_id)
    REFERENCES funding_projects(funding_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_reviews_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_reviews_order
    FOREIGN KEY (order_id)
    REFERENCES orders(order_id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS taste_profiles (
  taste_profile_id BIGSERIAL PRIMARY KEY,
  funding_id BIGINT,
  user_id BIGINT,
  sweetness INT,
  acidity INT,
  body INT,
  carbonation INT,
  alcohol_intensity INT,
  flavor_notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_taste_profiles_funding
    FOREIGN KEY (funding_id)
    REFERENCES funding_projects(funding_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_taste_profiles_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sul_bti_types (
  type_id BIGSERIAL PRIMARY KEY,
  type_code VARCHAR(30) NOT NULL UNIQUE,
  type_name VARCHAR(100),
  description TEXT
);

CREATE TABLE IF NOT EXISTS sul_bti_results (
  result_id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  type_id BIGINT,
  sweetness_score INT NOT NULL,
  body_score INT NOT NULL,
  carbonation_score INT NOT NULL,
  flavor_score INT NOT NULL,
  abv_score INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sul_bti_results_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_sul_bti_results_type
    FOREIGN KEY (type_id)
    REFERENCES sul_bti_types(type_id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS alcohols (
  alcohol_id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  abv DECIMAL(4,1) NOT NULL,
  brewery_auth_id BIGINT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_alcohols_brewery_auth
    FOREIGN KEY (brewery_auth_id)
    REFERENCES brewery_auth(application_id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS user_archives (
  archive_id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  alcohol_id BIGINT,
  archive_type VARCHAR(20) NOT NULL,
  rating DECIMAL(2,1),
  custom_name VARCHAR(100),
  category VARCHAR(50),
  abv DECIMAL(4,1),
  tasting_note TEXT,
  record_date DATE,
  mood VARCHAR(50),
  pairing VARCHAR(100),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_archives_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_user_archives_alcohol
    FOREIGN KEY (alcohol_id)
    REFERENCES alcohols(alcohol_id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS archive_tags (
  tag_id BIGSERIAL PRIMARY KEY,
  category VARCHAR(30) NOT NULL,
  name VARCHAR(50) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_archive_tags_category_name
    UNIQUE (category, name)
);

-- Archive tag categories:
-- - TASTE, SITUATION, MOOD are frontend fixed tags returned by GET /api/mypage/archives/tags.
-- - CUSTOM is used for user-entered customTags during archive create/update.
-- Fixed frontend seed reference:
-- TASTE: 달콤한, 깔끔한, 묵직한, 산미있는, 쓴맛, 고소한, 부드러운, 탄산있는, 구수한, 과일향
-- SITUATION: 혼술, 친구모임, 데이트, 특별한날, 식사중, 야외, 집들이, 기념일
-- MOOD: 행복한, 설레는, 그리운, 편안한, 들뜬, 차분한

CREATE TABLE IF NOT EXISTS user_archive_tags (
  archive_id BIGINT NOT NULL,
  tag_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_user_archive_tags
    PRIMARY KEY (archive_id, tag_id),
  CONSTRAINT fk_user_archive_tags_archive
    FOREIGN KEY (archive_id)
    REFERENCES user_archives(archive_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_user_archive_tags_tag
    FOREIGN KEY (tag_id)
    REFERENCES archive_tags(tag_id)
    ON DELETE CASCADE
);
