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
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP,
  CONSTRAINT fk_post_comments_post
    FOREIGN KEY (post_id)
    REFERENCES posts(post_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_post_comments_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
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

CREATE TABLE IF NOT EXISTS brewery_auth (
  application_id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  license_number VARCHAR(100) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  location VARCHAR(255),
  brewery_name VARCHAR(100),
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
