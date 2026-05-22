# Funding API Status

Checked on 2026-05-22 from repository code, SQL files, and the `judam` DB through the active SSM port forward on `localhost:5433`.

## Immediate Fixes Applied

- `POST /api/fundings/agreements`
  - Accepts 7 required agreement terms.
  - Accepts camelCase, snake_case, and frontend short keys:
    `age`, `contact`, `settlement`, `fee`, `responsibility`, `license`, `ip`.
  - Stores `is_license_agreed`, `is_ip_policy_agreed`, and `all_required_terms_agreed`.

- `PATCH /api/fundings/drafts/:draftId/brewery-info`
  - Accepts the 9 required frontend fields.
  - Accepts camelCase and snake_case names.
  - Accepts business registration number and phone number with or without hyphens.
  - Accepts numeric account number by converting it to string.
  - Uses `representativeName` as `accountHolder` fallback if account holder is omitted.

- `POST /api/fundings/drafts/:draftId/documents`
  - Accepts frontend document types:
    `idCard`, `businessLicense`, `salesPermit`, `alcoholPermit`, `manufacturingLicense`.
  - Keeps `alcoholPermit` and `manufacturingLicense` as distinct DB values.
  - Stores `mime_type` and `file_size`.

- DB migration added:
  - `database/20260522_funding_project_flow.sql`

- DB migration applied:
  - Applied to `judam` DB on 2026-05-22.
  - `brewery_logs` is owned by `judam_admin`, so `video_url`, `updated_at`, and the `brewery_logs(funding_id)` index were skipped for that table only.
  - Agreement and brewery-info API smoke tests passed against the DB.

- Project creation happy path tested:
  - Agreements -> basic info -> schedule -> legal info -> taste profile -> plan -> brewery info -> notices -> 5 documents -> submit.
  - The flow returned a submitted draft and created a reviewing funding project.
  - Test rows were cleaned up after verification.

## Status By Requirement

| No | Area | Current Status | Notes |
| --- | --- | --- | --- |
| 1 | Funding agreements | Implemented | Controller now supports 7 terms and migration adds needed columns. |
| 2 | Draft/common state | Partial | Draft APIs exist. Migration adds draft table/columns. Auth ownership checks are still weak. |
| 3 | Basic info | Partial | Saves core fields, image URL array, tags. Image order is represented by array order, not a separate `image_order` column. |
| 4 | Schedule | Partial | Saves price, quantity, target, start/end/delivery. `platformFeeRate`/`shippingFee` are mostly calculated/static, not fully request-driven. |
| 5 | Legal info | Implemented | Saves product type, volume, alcohol percentage, raw materials. |
| 6 | Taste profile | Implemented | Saves sweetness, acidity, body, carbonation, alcoholIntensity, flavor notes. |
| 7 | Project plan | Partial | Saves introduction, budget plan, schedule plan. `videoUrl` is not wired in controller yet. |
| 8 | Brewery/settlement/business info | Implemented for required fields | Optional profile/bio/business fields are partly stored. Migration adds matching columns. |
| 9 | Notices | Implemented | Saves refund, exchange, adult verification, risk notice. |
| 10 | Documents | Partial | Upload API exists and now supports 5 frontend document types. Real S3 upload is still mocked as `storage.example.com`. |
| 11 | Submit | Functional with policy gap | Happy-path submit works against `judam`. It currently creates a funding project during submit with `REVIEWING`; admin approval also creates a project separately. This needs one final policy. |
| 12 | Public list/detail | Partial | List/detail exist with liked/likeCount/supportOptions. Missing several detail fields such as imageUrls, delivery date, bottle size, full taste profile. |
| 13 | Support options | Partial | GET exists. No create/update option API found. Migration adds volume/alcohol columns used by controller. |
| 14 | Support order | Partial | Order creation exists with major fields. Some requested agreement fields are missing or simplified. |
| 15 | Payment/Toss | Partial | Payment request returns `paymentUrl`/`checkoutUrl`; Toss confirm updates payment/order/funding amount. Request URL is still mocked in `order.controller.js`. |
| 16 | Likes | Partial | Like/unlike and liked list exist. Many endpoints still use fallback user id `1` when auth is absent. |
| 17 | Brewery logs | Partial | CRUD, like, comments, replies exist with unique `log_id`. No `videoUrl` handling in controller yet. |
| 18 | Q&A | Partial | List/create/reply exist. Question like/unlike routes are missing. Replies are included. |
| 19 | Reviews | Partial | List/create exist. Update/delete/like/comment APIs are missing. Review eligibility checks are missing. |
| 20 | Share/report | Mostly mock | Share link and reports return static/mock data. DB migration adds future tables, but controller is not fully DB-backed. |
| 21 | Admin review | Partial | Submitted list/approve/reject exist. Approval currently uses hardcoded `recipeId = 3`, so it is not production-ready. |

## Main Gaps

- Repository `database/schema.sql` is older than the funding controller. The applied DB patch is tracked in `database/20260522_funding_project_flow.sql`.
- Several funding controllers still use `req.user?.userId || 1`; auth should be enforced before production.
- Some endpoints are DB-backed, while share/report/inquiry are still mock responses.
- Submit and admin approval both create public funding data; choose one source of truth to avoid duplicate funding projects.
- Real file upload is not wired for funding documents; URLs are placeholder values.
- `brewery_logs` owner is `judam_admin`, so additional brewery log columns/indexes require owner/admin migration.
- Project creation happy path works, but production completion still needs auth/ownership checks, real file upload, and submit/admin approval policy cleanup.
