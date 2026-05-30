CREATE TABLE IF NOT EXISTS funding_deliveries (
  delivery_id BIGSERIAL PRIMARY KEY,
  funding_id BIGINT NOT NULL,
  brewery_user_id BIGINT NOT NULL,
  courier VARCHAR(100) NOT NULL,
  tracking_number VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_funding_deliveries_funding
    FOREIGN KEY (funding_id)
    REFERENCES funding_projects(funding_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_funding_deliveries_brewery_user
    FOREIGN KEY (brewery_user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE,
  CONSTRAINT uq_funding_deliveries_funding
    UNIQUE (funding_id)
);

CREATE INDEX IF NOT EXISTS idx_funding_deliveries_brewery_user
  ON funding_deliveries(brewery_user_id);
