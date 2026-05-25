-- Funding review likes.

CREATE TABLE IF NOT EXISTS funding_review_likes (
  like_id BIGSERIAL PRIMARY KEY,
  review_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_funding_review_likes_review
    FOREIGN KEY (review_id)
    REFERENCES funding_reviews(review_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_funding_review_likes_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE,
  CONSTRAINT uq_funding_review_likes_review_user
    UNIQUE (review_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_funding_review_likes_review_id
  ON funding_review_likes(review_id);
