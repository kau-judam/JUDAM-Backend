CREATE TABLE IF NOT EXISTS brewery_profiles (
  profile_id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  application_id BIGINT,
  profile_image_url TEXT,
  brewery_name VARCHAR(100),
  one_line_introduction VARCHAR(120),
  short_introduction TEXT,
  brand_story TEXT,
  history TEXT,
  established_year INTEGER,
  representative_name VARCHAR(100),
  address TEXT,
  contact_email VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_brewery_profiles_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE,
  CONSTRAINT uq_brewery_profiles_user
    UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_brewery_profiles_user
ON brewery_profiles(user_id);

CREATE TABLE IF NOT EXISTS brewery_dashboard_notifications (
  notification_id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  content TEXT,
  link_url TEXT,
  image_url TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_brewery_dashboard_notifications_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_brewery_dashboard_notifications_type'
  ) THEN
    ALTER TABLE brewery_dashboard_notifications
    ADD CONSTRAINT chk_brewery_dashboard_notifications_type
    CHECK (
      type IN (
        'FUNDING_CREATED',
        'FUNDING_PROGRESS',
        'FUNDING_ENDED',
        'FUNDING_SUCCESS',
        'RECIPE_POPULAR'
      )
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_brewery_dashboard_notifications_user_created
ON brewery_dashboard_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_brewery_dashboard_notifications_user_read
ON brewery_dashboard_notifications(user_id, is_read);
