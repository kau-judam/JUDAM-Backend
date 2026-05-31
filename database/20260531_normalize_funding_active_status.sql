-- Normalize legacy public funding status values.
-- ONGOING was previously used as the open/public funding status in parts of
-- the backend. The order flow now consistently allows support only for ACTIVE.

UPDATE funding_projects
SET
  status = 'ACTIVE',
  updated_at = CURRENT_TIMESTAMP
WHERE status = 'ONGOING'
  AND end_date::date >= ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date);
