-- Repair corrupted Korean text for funding_id = 3 (산사 막걸리).
-- The broken values contain the replacement character (�), which means the
-- original bytes are already lost. This migration restores the known display
-- values used by the funding detail/intro/support option APIs.

DO $$
DECLARE
  raw_materials_type TEXT;
  draft_raw_materials_type TEXT;
  flavor_notes_type TEXT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'funding_projects'
      AND column_name = 'main_ingredient'
  ) THEN
    UPDATE funding_projects
    SET
      main_ingredient = '쌀',
      updated_at = CURRENT_TIMESTAMP
    WHERE funding_id = 3
      AND (
        main_ingredient IS NULL
        OR main_ingredient LIKE '%�%'
      );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'funding_projects'
      AND column_name = 'sub_ingredients'
  ) THEN
    UPDATE funding_projects
    SET
      sub_ingredients = '["산사"]',
      updated_at = CURRENT_TIMESTAMP
    WHERE funding_id = 3
      AND (
        sub_ingredients IS NULL
        OR sub_ingredients::text = '[]'
        OR sub_ingredients::text LIKE '%�%'
      );
  END IF;

  SELECT data_type
  INTO raw_materials_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'funding_projects'
    AND column_name = 'raw_materials'
  LIMIT 1;

  IF raw_materials_type = 'json' THEN
    EXECUTE '
      UPDATE funding_projects
      SET
        raw_materials = $1::json,
        updated_at = CURRENT_TIMESTAMP
      WHERE funding_id = 3
        AND (
          raw_materials IS NULL
          OR raw_materials::text = ''[]''
          OR raw_materials::text LIKE ''%�%''
        )
    '
    USING '[{"name":"쌀","origin":"국산"},{"name":"산사","origin":"국산"}]';
  ELSIF raw_materials_type = 'jsonb' THEN
    EXECUTE '
      UPDATE funding_projects
      SET
        raw_materials = $1::jsonb,
        updated_at = CURRENT_TIMESTAMP
      WHERE funding_id = 3
        AND (
          raw_materials IS NULL
          OR raw_materials::text = ''[]''
          OR raw_materials::text LIKE ''%�%''
        )
    '
    USING '[{"name":"쌀","origin":"국산"},{"name":"산사","origin":"국산"}]';
  ELSIF raw_materials_type IS NOT NULL THEN
    EXECUTE '
      UPDATE funding_projects
      SET
        raw_materials = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE funding_id = 3
        AND (
          raw_materials IS NULL
          OR raw_materials::text = ''[]''
          OR raw_materials::text LIKE ''%�%''
        )
    '
    USING '[{"name":"쌀","origin":"국산"},{"name":"산사","origin":"국산"}]';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'funding_drafts'
      AND column_name = 'main_ingredient'
  ) THEN
    UPDATE funding_drafts
    SET
      main_ingredient = '쌀',
      updated_at = CURRENT_TIMESTAMP
    WHERE funding_id = 3
      AND (
        main_ingredient IS NULL
        OR main_ingredient LIKE '%�%'
      );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'funding_drafts'
      AND column_name = 'sub_ingredients'
  ) THEN
    UPDATE funding_drafts
    SET
      sub_ingredients = '["산사"]',
      updated_at = CURRENT_TIMESTAMP
    WHERE funding_id = 3
      AND (
        sub_ingredients IS NULL
        OR sub_ingredients::text = '[]'
        OR sub_ingredients::text LIKE '%�%'
      );
  END IF;

  SELECT data_type
  INTO draft_raw_materials_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'funding_drafts'
    AND column_name = 'raw_materials'
  LIMIT 1;

  IF draft_raw_materials_type = 'json' THEN
    EXECUTE '
      UPDATE funding_drafts
      SET
        raw_materials = $1::json,
        updated_at = CURRENT_TIMESTAMP
      WHERE funding_id = 3
        AND (
          raw_materials IS NULL
          OR raw_materials::text = ''[]''
          OR raw_materials::text LIKE ''%�%''
        )
    '
    USING '[{"name":"쌀","origin":"국산"},{"name":"산사","origin":"국산"}]';
  ELSIF draft_raw_materials_type = 'jsonb' THEN
    EXECUTE '
      UPDATE funding_drafts
      SET
        raw_materials = $1::jsonb,
        updated_at = CURRENT_TIMESTAMP
      WHERE funding_id = 3
        AND (
          raw_materials IS NULL
          OR raw_materials::text = ''[]''
          OR raw_materials::text LIKE ''%�%''
        )
    '
    USING '[{"name":"쌀","origin":"국산"},{"name":"산사","origin":"국산"}]';
  ELSIF draft_raw_materials_type IS NOT NULL THEN
    EXECUTE '
      UPDATE funding_drafts
      SET
        raw_materials = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE funding_id = 3
        AND (
          raw_materials IS NULL
          OR raw_materials::text = ''[]''
          OR raw_materials::text LIKE ''%�%''
        )
    '
    USING '[{"name":"쌀","origin":"국산"},{"name":"산사","origin":"국산"}]';
  END IF;

  SELECT data_type
  INTO flavor_notes_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'taste_profiles'
    AND column_name = 'flavor_notes'
  LIMIT 1;

  IF flavor_notes_type = 'json' THEN
    EXECUTE '
      UPDATE taste_profiles
      SET
        flavor_notes = $1::json,
        updated_at = CURRENT_TIMESTAMP
      WHERE funding_id = 3
        AND (
          flavor_notes IS NULL
          OR flavor_notes::text = ''[]''
          OR flavor_notes::text LIKE ''%�%''
        )
    '
    USING '["달콤하고 산뜻한 산사향"]';
  ELSIF flavor_notes_type = 'jsonb' THEN
    EXECUTE '
      UPDATE taste_profiles
      SET
        flavor_notes = $1::jsonb,
        updated_at = CURRENT_TIMESTAMP
      WHERE funding_id = 3
        AND (
          flavor_notes IS NULL
          OR flavor_notes::text = ''[]''
          OR flavor_notes::text LIKE ''%�%''
        )
    '
    USING '["달콤하고 산뜻한 산사향"]';
  ELSIF flavor_notes_type IS NOT NULL THEN
    EXECUTE '
      UPDATE taste_profiles
      SET
        flavor_notes = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE funding_id = 3
        AND (
          flavor_notes IS NULL
          OR flavor_notes::text = ''[]''
          OR flavor_notes::text LIKE ''%�%''
        )
    '
    USING '["달콤하고 산뜻한 산사향"]';
  END IF;
END $$;
