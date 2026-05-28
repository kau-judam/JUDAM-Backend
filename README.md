# JUDAM-Backend

JUDAM backend API server built with Express and PostgreSQL.

## Harness Files

- Runtime entrypoint: `index.js`
- Express app harness: `app.js`
- Route mount table: `src/routes/index.js`
- Environment template: `.env.example`
- Database pool: `src/config/db.js`
- Legacy database compatibility path: `src/db.js`
- Funding DB migration: `database/20260522_funding_project_flow.sql`
- Funding follow-up migration: `database/20260522_funding_followup.sql`
- Funding interactions migration: `database/20260524_funding_interactions.sql`

More details:

- Project structure: `docs/PROJECT_STRUCTURE.md`
- Harness paths: `docs/HARNESS.md`
- Funding API status: `docs/FUNDING_API_STATUS.md`
- Funding frontend handoff: `docs/FRONTEND_HANDOFF_FUNDING.md`
- Brewery dashboard API: `docs/BREWERY_DASHBOARD_API.md`
- Work log: `docs/WORK_LOG.md`
- Database: `docs/DATABASE.md`

## Scripts

```bash
npm start
```

```bash
npm run dev
```

## Health Check

```http
GET /health
```
