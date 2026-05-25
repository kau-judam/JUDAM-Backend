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

- Funding follow-up migration added and applied:
  - `database/20260522_funding_followup.sql`
  - Adds `funding_drafts.funding_id`.
  - Adds review fields for frontend form: `mood`, `pairing`, `tags`, `record_visibility`.
  - Drops `funding_reviews.title` NOT NULL constraint.

- Funding creation/manage/community flow retested against `judam`:
  - Draft save/load/preview returns saved brewery bank/account, plan, video URL, budget, schedule, documents, and de-duplicated images.
  - Submit creates one `REVIEWING` funding project and admin approve updates that same funding to `ONGOING`.
  - Public detail returns draft-backed plan, brewery info, notices, legal info, documents, taste profile, and image fields.
  - Funding like no longer returns "펀딩 프로젝트를 찾을 수 없습니다." for the submitted/approved project.
  - Brewery log image upload returns a retrievable data URL when S3 upload is unavailable.
  - Brewery log comments persist multiple comments.
  - Q&A replies persist multiple replies, and Q&A like/unlike persists `liked` state.
  - Share/report are DB-backed.
  - Review create/update works without a title.
  - Test rows were cleaned up after verification.

- Address storage retested against `judam`:
  - `businessAddress` stores `[06236] 서울 강남구 테헤란로 152` unchanged in `funding_drafts.business_address`.
  - `shippingAddress` stores `[06236] 서울 강남구 테헤란로 152` unchanged in `orders.shipping_address`.
  - `orders.postal_code` is automatically extracted as `06236` when `postalCode` is omitted.

- Interaction follow-up tested against `judam`:
  - `database/20260524_funding_interactions.sql` applied.
  - Q&A reply like/unlike persists and `GET /api/fundings/:fundingId/questions` returns reply `liked`, `likeCount`, `writerNickname`.
  - Brewery log comment/reply likes persist and comment list returns `liked`/`likeCount` for both.
  - Review `PATCH` supports multipart image upload plus `deleteImageUrls`.
  - Review list/detail/create/update/delete responses include writer aliases: `writerId`, `writer_id`, `userId`, `user_id`.
  - Review list/detail/create/update responses include `detailReview` and `showRecord` aliases.
  - Review `DELETE` works.
  - Review detail comment APIs were added: list/create/comment like/comment unlike.
  - Review like/unlike APIs were added and list/detail return `liked`, `likeCount`.
  - Draft manage load by funding id was added: `GET /api/fundings/drafts/by-funding/:fundingId`.
  - Funding detail/like now resolve a submitted `draftId` to the linked `fundingId`.
  - Funding stats include `totalRaisedTenMillion` for ten-million KRW display.
  - Approved brewery info update API was added: `PATCH /api/breweries/applications/me`.
  - Funding list/detail return SulBTI match aliases: `sulbtiMatchScore`, `matchScore`, `tasteMatchScore`, `matchRate`.

## Status By Requirement

| No | Area | Current Status | Notes |
| --- | --- | --- | --- |
| 1 | Funding agreements | Implemented | Controller now supports 7 terms and migration adds needed columns. |
| 2 | Draft/common state | Implemented with auth gap | Draft APIs exist and `funding_drafts.funding_id` links a draft to its created funding. Auth ownership checks are still weak. |
| 3 | Basic info | Partial | Saves core fields, image URL array, tags. Image order is represented by array order, not a separate `image_order` column. |
| 4 | Schedule | Partial | Saves price, quantity, target, start/end/delivery. `platformFeeRate`/`shippingFee` are mostly calculated/static, not fully request-driven. |
| 5 | Legal info | Implemented | Saves product type, volume, alcohol percentage, raw materials. |
| 6 | Taste profile | Implemented | Saves sweetness, acidity, body, carbonation, alcoholIntensity, flavor notes. |
| 7 | Project plan | Implemented | Saves and returns introduction, `videoUrl`, budget plan, and schedule plan. |
| 8 | Brewery/settlement/business info | Implemented for required fields | Optional profile/bio/business fields are partly stored. Migration adds matching columns. |
| 9 | Notices | Implemented | Saves refund, exchange, adult verification, risk notice. |
| 10 | Documents | Functional | Upload API supports 5 frontend document types and stores file metadata/URL. S3 is used when configured; otherwise a data URL fallback is stored. |
| 11 | Submit | Functional | Happy-path submit works against `judam`. It creates a `REVIEWING` funding project and stores `funding_id` on the draft. |
| 12 | Public list/detail | Improved | List/detail include de-duplicated image fields, liked/likeCount, schedule/price fields, support options, taste profile, plan, brewery info, notices, legal info, and documents. Detail resolves submitted draft ids to linked funding ids. |
| 13 | Support options | Partial | GET exists. No create/update option API found. Migration adds volume/alcohol columns used by controller. |
| 14 | Support order | Partial | Order creation exists with major fields. Some requested agreement fields are missing or simplified. |
| 15 | Payment/Toss | Partial | Payment request returns `paymentUrl`/`checkoutUrl`; Toss confirm updates payment/order/funding amount. Request URL is still mocked in `order.controller.js`. |
| 16 | Likes | Partial | Like/unlike and liked list exist. Many endpoints still use fallback user id `1` when auth is absent. |
| 17 | Brewery logs | Improved | CRUD, like, comments, replies exist with unique `log_id`. Image upload now stores a usable URL fallback. No `videoUrl` handling in controller yet. |
| 18 | Q&A | Improved | List/create/reply, question like/unlike, and reply like/unlike exist. Replies include writer, `likeCount`, and `liked`. |
| 19 | Reviews | Improved | List/detail/create/update/delete exist. Responses include writer id aliases plus `detailReview`/`showRecord`. Review like/unlike exist. Detail comments list/create/like/unlike exist. Update supports multipart images, JSON-string `tags`, and `deleteImageUrls`. Eligibility checks are still missing. |
| 20 | Share/report | Implemented | Share link and reports are DB-backed. Share count increments and reports persist selected reason/detail content. |
| 21 | Admin review | Improved | Approval updates the funding created during submit instead of creating a duplicate when `draft.funding_id` exists. Fallback path still uses `recipeId = 3` for old drafts without a linked funding. |

## Main Gaps

- Repository `database/schema.sql` is older than the funding controller. The applied DB patch is tracked in `database/20260522_funding_project_flow.sql`.
- Several funding controllers still use `req.user?.userId || 1`; auth should be enforced before production.
- `createFundingInquiry` is still a mock response.
- Old drafts without `funding_id` still fall back to admin approval's `recipeId = 3` path.
- S3 upload requires correct bucket/IAM configuration. Local/test fallback stores data URLs unless `FILE_UPLOAD_STRICT_S3=true`.
- `brewery_logs` owner is `judam_admin`, so additional brewery log columns/indexes require owner/admin migration.
- Project creation/manage happy path works, but production completion still needs auth/ownership checks, real SMS verification, real account verification, and S3/IAM hardening.
