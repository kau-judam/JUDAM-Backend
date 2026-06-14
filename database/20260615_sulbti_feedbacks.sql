CREATE TABLE IF NOT EXISTS sulbti_feedbacks (
  feedback_id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  sulbti_result_id BIGINT NOT NULL,
  bti_code VARCHAR(20) NOT NULL,
  is_matched BOOLEAN NOT NULL,
  mismatched_axes JSONB NOT NULL DEFAULT '[]'::jsonb,
  comment TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sulbti_feedbacks_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_sulbti_feedbacks_result
    FOREIGN KEY (sulbti_result_id)
    REFERENCES sul_bti_results(result_id)
    ON DELETE CASCADE,
  CONSTRAINT uq_sulbti_feedbacks_user_result
    UNIQUE (user_id, sulbti_result_id)
);

CREATE INDEX IF NOT EXISTS idx_sulbti_feedbacks_result
  ON sulbti_feedbacks(sulbti_result_id);
