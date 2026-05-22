# Harness Paths

This document lists the files that bootstrap or harness the backend runtime.

## Runtime Harness

- Entrypoint: `index.js`
- Express app: `app.js`
- Route mount table: `src/routes/index.js`
- Environment template: `.env.example`
- npm scripts: `package.json`

## Start Commands

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

Expected response:

```json
{
  "message": "backend ok"
}
```

## Database Harness

- Shared pool: `src/config/db.js`
- Legacy compatibility path: `src/db.js`
- Schema: `database/schema.sql`

New code should import the database pool from `src/config/db.js`. Existing code that imports `src/db.js` continues to work because it re-exports the shared pool.
