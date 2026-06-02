ALTER TABLE brewery_dashboard_notifications
  DROP CONSTRAINT IF EXISTS chk_brewery_dashboard_notifications_type;

ALTER TABLE brewery_dashboard_notifications
  ADD CONSTRAINT chk_brewery_dashboard_notifications_type
  CHECK (
    type IN (
      'FUNDING_CREATED',
      'FUNDING_PROGRESS',
      'FUNDING_ENDED',
      'FUNDING_SUCCESS',
      'SETTLEMENT_COMPLETED',
      'RECIPE_POPULAR'
    )
  );
