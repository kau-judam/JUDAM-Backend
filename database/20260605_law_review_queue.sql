CREATE TABLE IF NOT EXISTS law_review_queue (
  review_id BIGSERIAL PRIMARY KEY,
  target_type VARCHAR(50) NOT NULL,
  target_id BIGINT,
  submitter_user_id BIGINT,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_verdict VARCHAR(20) NOT NULL DEFAULT 'review',
  ai_violation BOOLEAN NOT NULL DEFAULT false,
  ai_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_recommendation TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  admin_memo TEXT,
  reviewed_at TIMESTAMP,
  reviewed_by BIGINT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_law_review_queue_submitter
    FOREIGN KEY (submitter_user_id)
    REFERENCES users(user_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_law_review_queue_reviewer
    FOREIGN KEY (reviewed_by)
    REFERENCES users(user_id)
    ON DELETE SET NULL,
  CONSTRAINT chk_law_review_queue_target_type
    CHECK (target_type IN ('RECIPE')),
  CONSTRAINT chk_law_review_queue_ai_verdict
    CHECK (ai_verdict IN ('block', 'pass', 'review')),
  CONSTRAINT chk_law_review_queue_status
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))
);

CREATE INDEX IF NOT EXISTS idx_law_review_queue_status_created
ON law_review_queue(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_law_review_queue_submitter
ON law_review_queue(submitter_user_id, created_at DESC);
