# Database

이 프로젝트의 백엔드 작업과 검증은 `Judam` DB만 기준으로 진행합니다.

## Active Connection

- DB name: `judam`
- Local host: `localhost`
- Local port: `5433`
- User: `judam_jaewon`
- SSL: `true`
- Connection path: active SSM port forward to the Judam RDS PostgreSQL instance

Do not use the old `smart_health_dog` database for this project.

## Runtime Rule

`index.js` loads `.env` with `override: true` so stale shell environment variables do not override the project DB settings.

## Migration Status

Applied to `judam`:

- `database/20260522_funding_project_flow.sql`
- `database/20260522_funding_followup.sql`
- `database/20260524_funding_interactions.sql`
- `database/20260524_funding_review_comments.sql`
- `database/20260525_funding_review_likes.sql`
- `database/20260525_funding_bank_account_verifications.sql`
- `database/20260528_brewery_dashboard_profile_notifications.sql`
- `database/20260530_funding_deliveries.sql`
  - Creates `funding_deliveries` for completed funding delivery management.
  - Stores one delivery row per `funding_id` through a unique constraint.
- `database/20260530_brewery_log_video_url.sql`
  - Adds `brewery_logs.video_url`, `brewery_logs.updated_at`, and `idx_brewery_logs_funding_id`.
- `database/20260530_brewery_dashboard_notification_events.sql`
  - Adds event fields for brewery dashboard notification auto-generation.
  - Adds unique event-key index for duplicate prevention.
- `database/20260602_brewery_dashboard_settlement_notification_type.sql`
  - Adds `SETTLEMENT_COMPLETED` to the brewery dashboard notification type check constraint.

Pending Judam DB application:

- None currently tracked for the dashboard migrations above.

Latest verification:

- Rechecked after merge on 2026-05-25.
- Confirmed `current_database() = judam` and `current_user = judam_jaewon`.
- Confirmed `funding_review_comments`, `funding_review_comment_likes`, and `funding_review_likes`.
- Confirmed review comment/like indexes:
  - `idx_funding_review_comments_review_id`
  - `idx_funding_review_comments_funding_review`
  - `idx_funding_review_comment_likes_comment_id`
  - `idx_funding_review_likes_review_id`
- Confirmed review metadata columns still exist on `funding_reviews`: `mood`, `pairing`, `tags`, `record_visibility`, `updated_at`.
- Applied and confirmed `funding_bank_account_verifications` for funding bank account verification request/confirm APIs.
- Deleted all `funding_projects`/linked `funding_drafts` with exact title `test`; verified remaining count is 0.
- Re-opened the SSM port forward on 2026-05-22.
- Confirmed `current_database() = judam` and `current_user = judam_jaewon`.
- Applied `database/20260522_funding_followup.sql`.
- Confirmed `funding_drafts.funding_id`.
- Confirmed `funding_reviews.mood`, `pairing`, `tags`, `record_visibility`, `updated_at`.
- Confirmed `funding_reviews.title` is nullable for the frontend review form.
- Applied `database/20260524_funding_interactions.sql` on 2026-05-24.
- Confirmed `funding_question_reply_likes` for Q&A reply like persistence.
- Added `database/20260524_funding_review_comments.sql` for review detail comments and comment likes.
- Applied `database/20260525_funding_review_likes.sql` on 2026-05-25.
- Confirmed funding review like persistence through `funding_review_likes`.
- Applied `database/20260528_brewery_dashboard_profile_notifications.sql` on 2026-05-28.
- Confirmed `brewery_profiles` for editable brewery dashboard profile fields.
- Confirmed `brewery_dashboard_notifications` for brewery dashboard notification persistence.
- Applied `database/20260530_brewery_dashboard_notification_events.sql`.
- Confirmed `brewery_dashboard_notifications.event_key`, `funding_id`, `recipe_id`, `progress_threshold`, and `metadata`.
- Applied `database/20260530_funding_deliveries.sql`.
- Confirmed `funding_deliveries` FK/unique/index constraints.
- Confirmed `brewery_logs.video_url`, `brewery_logs.updated_at`, and `idx_brewery_logs_funding_id`.
- Applied `database/20260602_brewery_dashboard_settlement_notification_type.sql`.
- Confirmed `chk_brewery_dashboard_notifications_type` includes `SETTLEMENT_COMPLETED`.

Ownership note:

- `brewery_logs` is still owned by `judam_admin`; future migrations for that table may require owner/admin privileges.
