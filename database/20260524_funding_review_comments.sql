-- Funding review detail comments and comment likes.

CREATE TABLE IF NOT EXISTS funding_review_comments (
  comment_id BIGSERIAL PRIMARY KEY,
  funding_id BIGINT NOT NULL,
  review_id BIGINT NOT NULL,
  user_id BIGINT,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP,
  CONSTRAINT fk_funding_review_comments_funding
    FOREIGN KEY (funding_id)
    REFERENCES funding_projects(funding_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_funding_review_comments_review
    FOREIGN KEY (review_id)
    REFERENCES funding_reviews(review_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_funding_review_comments_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_funding_review_comments_review_id
  ON funding_review_comments(review_id);

CREATE INDEX IF NOT EXISTS idx_funding_review_comments_funding_review
  ON funding_review_comments(funding_id, review_id);

CREATE TABLE IF NOT EXISTS funding_review_comment_likes (
  like_id BIGSERIAL PRIMARY KEY,
  comment_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_funding_review_comment_likes_comment
    FOREIGN KEY (comment_id)
    REFERENCES funding_review_comments(comment_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_funding_review_comment_likes_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE,
  CONSTRAINT uq_funding_review_comment_likes_comment_user
    UNIQUE (comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_funding_review_comment_likes_comment_id
  ON funding_review_comment_likes(comment_id);
