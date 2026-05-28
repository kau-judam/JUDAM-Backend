# Project Structure

JUDAM-Backend is an Express API server using CommonJS modules and PostgreSQL.

## Root Harness Files

These files are the runtime harness for the API server.

- `index.js`: process entrypoint. Loads `.env`, imports `app.js`, and starts the HTTP server.
- `app.js`: Express application harness. Applies global middleware, health check, and route mounting.
- `package.json`: npm script harness. `npm start` runs `index.js`; `npm run dev` runs `nodemon index.js`.
- `.env.example`: environment variable template used by the runtime harness.

## Source Layout

- `src/routes/index.js`: central API route mount table used by `app.js`.
- `src/routes/`: Express routers grouped by feature.
- `src/controllers/`: request/response handlers.
- `src/services/`: business logic, external API clients, and database calls.
- `src/middlewares/`: authentication and authorization middleware.
- `src/config/db.js`: shared PostgreSQL pool configuration.
- `src/db.js`: compatibility export for older imports; it re-exports `src/config/db.js`.
- `src/utils/`: shared helper modules.

## Data And History

- `database/schema.sql`: primary PostgreSQL schema.
- `database/*.sql`: incremental schema changes.
- `devlog/`: feature and implementation notes.

## Public Route Groups

- `/health`: server health check.
- `/api/auth`, `/auth`: Kakao auth and legacy auth.
- `/api/users`, `/api/mypage`: user profile and mypage APIs.
- `/api/recipes`: recipe, recipe comments, interests, and brewery recipe APIs.
- `/api/fundings`: funding drafts, funding projects, orders, reviews, inquiries, reports, and brewery logs.
- `/api/orders`, `/api/payments`: order and payment APIs.
- `/api/breweries`: brewery application, profile, and dashboard notification APIs.
- `/api/notifications`: authenticated notification read-state APIs.
- `/api/ai`, `/api/recipe`, `/api/survey`: AI integration APIs.
- `/api/sqs`: SQS integration test API.
- `/api/posts`: community post APIs.
