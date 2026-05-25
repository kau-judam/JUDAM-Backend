-- Funding interaction follow-up for Q&A reply likes.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS funding_question_reply_likes (
  like_id BIGSERIAL PRIMARY KEY,
  reply_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_funding_question_reply_likes_reply
    FOREIGN KEY (reply_id)
    REFERENCES funding_question_replies(reply_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_funding_question_reply_likes_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE,
  CONSTRAINT uq_funding_question_reply_likes_reply_user
    UNIQUE (reply_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_funding_question_reply_likes_reply_id
  ON funding_question_reply_likes(reply_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_funding_question_reply_likes_reply_user_idx
  ON funding_question_reply_likes(reply_id, user_id);
