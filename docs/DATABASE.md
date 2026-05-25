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

Skipped because `brewery_logs` is owned by `judam_admin`:

- `brewery_logs.video_url`
- `brewery_logs.updated_at`
- `idx_brewery_logs_funding_id`

These skipped items require the table owner or an admin account.
