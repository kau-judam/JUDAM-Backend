CREATE TABLE IF NOT EXISTS brewery_insight_orders (
  id BIGSERIAL PRIMARY KEY,
  order_id VARCHAR(100) NOT NULL UNIQUE,
  brewery_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  order_name VARCHAR(255) NOT NULL,
  plan_type VARCHAR(30) NOT NULL,
  payment_status VARCHAR(30) NOT NULL DEFAULT 'READY',
  toss_payment_key VARCHAR(255),
  toss_response JSONB,
  paid_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_brewery_insight_orders_user_latest
ON brewery_insight_orders (brewery_user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS brewery_insight_access (
  id BIGSERIAL PRIMARY KEY,
  brewery_user_id BIGINT NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
  plan_type VARCHAR(30),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_brewery_insight_access_user
ON brewery_insight_access (brewery_user_id);
