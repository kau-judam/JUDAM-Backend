-- Keep rejected funding drafts and linked funding projects in sync.
-- Some review flows updated funding_drafts.status to REJECTED while leaving
-- funding_projects.status as REVIEWING, which made public/admin responses look
-- like the project was still under review.

UPDATE funding_projects fp
SET
  status = 'REJECTED',
  updated_at = CURRENT_TIMESTAMP
FROM funding_drafts fd
WHERE fd.funding_id = fp.funding_id
  AND fd.status = 'REJECTED'
  AND fp.status IN ('READY', 'REVIEWING', 'SUBMITTED', 'ONGOING');
