ALTER TABLE brewery_dashboard_notifications
  ADD COLUMN IF NOT EXISTS event_key VARCHAR(160),
  ADD COLUMN IF NOT EXISTS funding_id BIGINT,
  ADD COLUMN IF NOT EXISTS recipe_id BIGINT,
  ADD COLUMN IF NOT EXISTS progress_threshold INTEGER,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_brewery_dashboard_notifications_user_event_key
  ON brewery_dashboard_notifications(user_id, event_key)
  WHERE event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_brewery_dashboard_notifications_funding
  ON brewery_dashboard_notifications(funding_id)
  WHERE funding_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_brewery_dashboard_notifications_recipe
  ON brewery_dashboard_notifications(recipe_id)
  WHERE recipe_id IS NOT NULL;
