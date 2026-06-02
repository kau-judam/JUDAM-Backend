-- Backfill a default support option for active funding projects that can be
-- supported by price_per_bottle but do not have any funding_support_options.
-- This repairs demo/legacy projects approved before support options were
-- created as part of the admin approval flow.

INSERT INTO funding_support_options (
  funding_id,
  name,
  price,
  description,
  stock,
  remaining_stock,
  max_per_user
)
SELECT
  fp.funding_id,
  LEFT(
    COALESCE(NULLIF(fp.short_title, ''), NULLIF(fp.title, ''), '기본 후원 옵션') || ' 기본 후원',
    100
  ) AS name,
  fp.price_per_bottle AS price,
  COALESCE(NULLIF(fp.summary, ''), NULLIF(fp.description, ''), fp.title, '기본 후원 옵션') AS description,
  100 AS stock,
  100 AS remaining_stock,
  10 AS max_per_user
FROM funding_projects fp
WHERE fp.status = 'ACTIVE'
  AND COALESCE(fp.price_per_bottle, 0) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM funding_support_options fso
    WHERE fso.funding_id = fp.funding_id
  );
