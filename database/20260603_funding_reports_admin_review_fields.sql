-- Stabilize funding report source of truth and add admin review fields.
-- Official table: funding_reports

CREATE TABLE IF NOT EXISTS funding_reports (
  report_id BIGSERIAL PRIMARY KEY,
  funding_id BIGINT NOT NULL,
  reporter_id BIGINT,
  reason VARCHAR(50) NOT NULL,
  content TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  admin_memo TEXT,
  reviewed_at TIMESTAMP,
  reviewed_by BIGINT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_funding_reports_funding
    FOREIGN KEY (funding_id)
    REFERENCES funding_projects(funding_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_funding_reports_reporter
    FOREIGN KEY (reporter_id)
    REFERENCES users(user_id)
    ON DELETE SET NULL
);

ALTER TABLE funding_reports
  ADD COLUMN IF NOT EXISTS admin_memo TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS reviewed_by BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_funding_reports_reviewed_by'
  ) THEN
    ALTER TABLE funding_reports
      ADD CONSTRAINT fk_funding_reports_reviewed_by
      FOREIGN KEY (reviewed_by)
      REFERENCES users(user_id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.funding_project_reports') IS NOT NULL THEN
    INSERT INTO funding_reports (
      report_id,
      funding_id,
      reporter_id,
      reason,
      content,
      status,
      created_at,
      updated_at
    )
    SELECT
      report_id,
      funding_id,
      reporter_id,
      reason,
      content,
      status,
      created_at,
      updated_at
    FROM funding_project_reports
    ON CONFLICT (report_id) DO NOTHING;

    PERFORM setval(
      pg_get_serial_sequence('funding_reports', 'report_id'),
      COALESCE((SELECT MAX(report_id) FROM funding_reports), 1),
      (SELECT COUNT(*) > 0 FROM funding_reports)
    );
  END IF;
END $$;
