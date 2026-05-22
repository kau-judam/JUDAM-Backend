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

Latest verification:

- Re-opened the SSM port forward on 2026-05-22.
- Confirmed `current_database() = judam` and `current_user = judam_jaewon`.
- Applied `database/20260522_funding_followup.sql`.
- Confirmed `funding_drafts.funding_id`.
- Confirmed `funding_reviews.mood`, `pairing`, `tags`, `record_visibility`, `updated_at`.
- Confirmed `funding_reviews.title` is nullable for the frontend review form.

Skipped because `brewery_logs` is owned by `judam_admin`:

- `brewery_logs.video_url`
- `brewery_logs.updated_at`
- `idx_brewery_logs_funding_id`

These skipped items require the table owner or an admin account.
