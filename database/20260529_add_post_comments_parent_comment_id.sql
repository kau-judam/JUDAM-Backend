-- 13주차 게시글 댓글 CRUD 선결 마이그레이션
-- post_comments 테이블에 대댓글(parent_comment_id) 컬럼 + 자기참조 FK 추가
-- like_count / updated_at은 schema.sql에 이미 정의되어 있으나, 운영 RDS에 누락된 환경을 대비해 함께 보강(IF NOT EXISTS)
ALTER TABLE post_comments
  ADD COLUMN IF NOT EXISTS like_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS parent_comment_id BIGINT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_post_comments_parent'
  ) THEN
    ALTER TABLE post_comments
      ADD CONSTRAINT fk_post_comments_parent
      FOREIGN KEY (parent_comment_id)
      REFERENCES post_comments(comment_id)
      ON DELETE CASCADE;
  END IF;
END $$;
