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
