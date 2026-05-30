# Funding Frontend Handoff

Last updated: 2026-05-26

## S3 Permission Request

Backend upload code uses AWS SDK `PutObject` only.

- Service file: `src/services/s3.service.js`
- Upload key pattern: `uploads/{ownerId}/{timestamp}-{originalname}`
- Returned URL pattern: `https://{AWS_S3_BUCKET}.s3.{AWS_REGION}.amazonaws.com/{key}`
- Current fallback: if S3 upload fails and `FILE_UPLOAD_STRICT_S3` is not `true`, backend stores a data URL so local tests do not show broken/gray images.
- Production recommendation: set `FILE_UPLOAD_STRICT_S3=true` after S3 permission is fixed.

Request this from the server/infra owner:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "JudamBackendUploadObjects",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::<AWS_S3_BUCKET>/uploads/*"
    }
  ]
}
```

Also decide one image read policy:

- Public object read through bucket policy, or
- CloudFront distribution in front of the bucket, or
- Backend-generated signed read URLs.

Current backend returns a plain HTTPS object URL, so uploaded objects must be readable by the app through that URL or through the chosen CDN URL.

Required production env values:

```bash
AWS_REGION=<bucket-region>
AWS_S3_BUCKET=<bucket-name>
FILE_UPLOAD_STRICT_S3=true
```

Credentials can be provided by `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` or by the server runtime role.

S3 CORS is not required for upload because the app uploads files to the backend, and the backend uploads to S3. If a web frontend directly renders S3 images in browser context, add GET/HEAD CORS for the frontend origin.

## Address Handling

Frontend owns address search.

Frontend opens Daum/Kakao address search inside `react-native-webview`, extracts:

- `zonecode`
- `address`
- `roadAddress`
- `jibunAddress`
- `buildingName`

Frontend sends one formatted string:

```text
[06236] 서울 강남구 테헤란로 152
```

Backend does not call an address API.

Backend stores the received address string as-is:

- Funding brewery/business address -> `funding_drafts.business_address`
- Support order shipping address -> `orders.shipping_address`

For support orders, if `postalCode` is omitted, backend extracts the five-digit code from the leading bracket format and stores it in `orders.postal_code`.

Verified against `judam` DB:

- `businessAddress: "[06236] 서울 강남구 테헤란로 152"` saved and loaded unchanged.
- `shippingAddress: "[06236] 서울 강남구 테헤란로 152"` saved unchanged.
- `postalCode` automatically saved as `06236`.

## Address APIs

### Save Brewery Business Address

```http
PATCH /api/fundings/drafts/:draftId/brewery-info
Content-Type: application/json
```

Required body includes:

```json
{
  "breweryName": "양조장명",
  "representativeName": "대표자명",
  "businessRegistrationNumber": "123-45-67890",
  "businessAddress": "[06236] 서울 강남구 테헤란로 152",
  "contactEmail": "example@company.com",
  "contactPhone": "010-1234-5678",
  "bankName": "국민은행",
  "accountNumber": "12345678901234",
  "accountHolder": "대표자명"
}
```

Response includes:

```json
{
  "businessAddress": "[06236] 서울 강남구 테헤란로 152",
  "progressRate": 85
}
```

Load it back:

```http
GET /api/fundings/drafts/:draftId/brewery-info/load
GET /api/fundings/drafts/:draftId/preview
```

### Load Draft For Manage/Edit

관리하기 화면에서 `fundingId`를 알고 있으면 아래 API로 연결된 draft 전체 데이터를 불러올 수 있습니다.

```http
GET /api/fundings/drafts/by-funding/:fundingId
```

응답은 `GET /api/fundings/drafts/:draftId/preview`와 같은 구조입니다.

포함 값:

- `draftId`
- `fundingId`
- `status`
- `progressRate`
- `basicInfo.thumbnailUrl`
- `basicInfo.imageUrls`: 대표 이미지를 제외한 추가 이미지
- `basicInfo.allImageUrls`: 대표 이미지 포함 전체 이미지, 중복 제거됨
- `plan.videoUrl`
- `plan.budgetPlan`
- `plan.schedulePlan`
- `breweryInfo.bankName`
- `breweryInfo.accountNumber`
- `breweryInfo.representativeName`
- `breweryInfo.businessType`
- `breweryInfo.businessCategory`
- `breweryInfo.businessItem`
- `breweryInfo.identityDocumentUrl`
- `breweryInfo.businessRegistrationFileUrl`
- `documents`: 필수 서류 5종

대표 이미지는 중복 방지를 위해 다음처럼 사용하면 됩니다.

```ts
const images = draft.basicInfo.allImageUrls;
```

`thumbnailUrl`과 `allImageUrls`를 단순 합치면 중복 표시될 수 있으므로, 화면 갤러리는 `allImageUrls` 기준 사용을 권장합니다.

### Public Funding Detail Image Fields

```http
GET /api/fundings/:fundingId
```

Image fields are normalized as arrays:

```json
{
  "thumbnailUrl": "https://example.com/main.png",
  "imageUrls": ["https://example.com/sub.png"],
  "allImageUrls": ["https://example.com/main.png", "https://example.com/sub.png"]
}
```

- `imageUrls`: array only; additional images excluding `thumbnailUrl`
- `allImageUrls`: array only; representative image plus additional images, de-duplicated
- The backend now also handles legacy DB values that were stored as one plain string or one JSON string.

### Submit Draft And Open Created Funding

```http
POST /api/fundings/drafts/:draftId/submit
```

응답:

```json
{
  "draftId": 29,
  "fundingId": 22,
  "recipeId": 100,
  "status": "SUBMITTED",
  "fundingStatus": "REVIEWING",
  "progressRate": 100
}
```

상세/찜 API는 프론트가 실수로 `draftId`를 넘겨도 연결된 `fundingId`를 찾아 처리하도록 보강했습니다.
그래도 프론트에서는 submit 응답의 `fundingId`를 저장해서 사용하는 것을 권장합니다.

### Save Support Shipping Address

```http
POST /api/fundings/:fundingId/orders
Content-Type: application/json
```

Body:

```json
{
  "optionId": 1,
  "quantity": 2,
  "recipientName": "수령자",
  "recipientPhone": "010-9999-8888",
  "shippingAddress": "[06236] 서울 강남구 테헤란로 152",
  "shippingDetailAddress": "12층",
  "adultVerified": true,
  "noticeAgreed": true,
  "privacyThirdPartyAgreed": true
}
```

Optional aliases accepted:

- `shipping_address`
- `shipping_detail_address`
- `postalCode`
- `postal_code`
- `zonecode`
- `additionalSupportAmount`
- `additional_support_amount`
- `privacyAgreed`
- `privacy_agreed`

Response includes:

```json
{
  "shippingAddress": "[06236] 서울 강남구 테헤란로 152",
  "shippingDetailAddress": "12층",
  "postalCode": "06236"
}
```

Recent shipping address:

```http
GET /api/users/me/recent-shipping-address
```

## Bank Account Verification APIs

These APIs are for the funding project creation > brewery info tab > deposit account verification flow.

### Request Verification

```http
POST /api/fundings/bank-account/verification
Content-Type: application/json
```

Request:

```json
{
  "bankName": "국민은행",
  "accountNumber": "123-456-7890",
  "accountHolder": "홍길동"
}
```

Response:

```json
{
  "verificationId": 1,
  "bankName": "국민은행",
  "accountNumber": "123-456-7890",
  "accountHolder": "홍길동",
  "verified": false,
  "accountVerified": false,
  "bankVerificationToken": null,
  "status": "PENDING",
  "requestedAt": "2026-05-25T00:00:00.000Z",
  "expiresAt": "2026-05-25T00:10:00.000Z",
  "message": "계좌 인증 요청이 생성되었습니다."
}
```

Local/dev can include this extra field unless `NODE_ENV=production`:

```json
{
  "verificationCode": "1234"
}
```

Production note: the real 1-won transfer/provider must send the code to the user's bank account. Until that provider is wired, local/dev uses the returned `verificationCode` only for integration testing.

### Confirm Verification

```http
POST /api/fundings/bank-account/verification/confirm
Content-Type: application/json
```

Request:

```json
{
  "verificationId": 1,
  "bankName": "국민은행",
  "accountNumber": "1234567890",
  "accountHolder": "홍길동",
  "verificationCode": "1234"
}
```

Aliases accepted for code:

- `verificationCode`
- `verification_code`
- `code`
- `senderCode`
- `sender_code`

Response:

```json
{
  "verificationId": 1,
  "bankName": "국민은행",
  "accountNumber": "123-456-7890",
  "accountHolder": "홍길동",
  "verified": true,
  "accountVerified": true,
  "bankVerificationToken": "token-string",
  "status": "VERIFIED",
  "confirmedAt": "2026-05-25T00:03:00.000Z",
  "message": "계좌 인증이 완료되었습니다."
}
```

When saving brewery info, send the returned token together with the account fields:

```http
PATCH /api/fundings/drafts/:draftId/brewery-info
Content-Type: application/json
```

```json
{
  "bankName": "국민은행",
  "accountNumber": "1234567890",
  "accountHolder": "홍길동",
  "bankVerificationToken": "token-string",
  "accountVerified": true
}
```

If `bankVerificationToken` is present, backend validates the token and stores `accountVerified: true`.

Optional direct draft update endpoint:

```http
POST /api/fundings/drafts/:draftId/account-verification
Content-Type: application/json
```

This endpoint now also requires a confirmed `bankVerificationToken`.

```json
{
  "bankName": "국민은행",
  "accountNumber": "1234567890",
  "accountHolder": "홍길동",
  "bankVerificationToken": "token-string"
}
```

Do not use the old immediate-complete behavior. Frontend should request verification first, confirm it, then save/update the draft with the returned token.

## Upload APIs

### Draft File Upload

```http
POST /api/fundings/drafts/:draftId/files
Content-Type: multipart/form-data
```

Fields:

- `file`: file
- `fileType`: one of `PROFILE_IMAGE`, `IDENTITY_DOCUMENT`, `BUSINESS_REGISTRATION`

### Funding Documents

```http
POST /api/fundings/drafts/:draftId/documents
Content-Type: multipart/form-data
```

Fields:

- `file`: file
- `documentType`: one of `idCard`, `businessLicense`, `salesPermit`, `alcoholPermit`, `manufacturingLicense`

Allowed document MIME types:

- `application/pdf`
- `image/jpeg`
- `image/png`

### Brewery Logs

```http
POST /api/fundings/:fundingId/brewery-logs
PATCH /api/fundings/:fundingId/brewery-logs/:breweryLogId
Content-Type: multipart/form-data
```

Fields:

- `images`: up to 5 files
- `stage`
- `title`
- `content`
- `videoUrl`: optional string URL, not a file upload
- `imageUrls`: optional JSON string array of existing image URLs to keep
- `deleteImageUrls`: optional JSON string array of image URLs to remove on PATCH

Notes:

- `videoUrl` and `images` are separate fields.
- `PATCH` with `videoUrl` as an empty string clears the existing video URL.
- Response uses `videoUrl`.

Response includes:

```json
{
  "breweryLogId": 101,
  "logId": 101,
  "fundingId": 1,
  "stage": "INGREDIENT",
  "title": "원료 입고 및 세척 완료",
  "content": "고양 지역 쌀 120kg을 입고하고 선별 세척을 마쳤습니다.",
  "videoUrl": "https://example.com/video",
  "imageUrls": ["https://example.com/log-image-1.jpg"],
  "createdAt": "2026-05-21T10:00:00.000Z",
  "updatedAt": "2026-05-21T10:00:00.000Z"
}
```

Required DB migration:

```text
database/20260530_brewery_log_video_url.sql
```

### Review Images

```http
POST /api/fundings/:fundingId/reviews
PATCH /api/fundings/:fundingId/reviews/:reviewId
Content-Type: multipart/form-data
```

Fields:

- `images`: up to 5 files
- `rating`
- `content` or `detailReview`
- `mood`
- `pairing`
- `tags`: JSON string array accepted
- `recordVisibility`
- `deleteImageUrls`: optional JSON string array of image URLs to remove on PATCH

## Q&A Reply Likes

```http
POST /api/fundings/:fundingId/questions/:questionId/replies/:replyId/likes
DELETE /api/fundings/:fundingId/questions/:questionId/replies/:replyId/likes
```

Response:

```json
{
  "fundingId": 1,
  "questionId": 1,
  "replyId": 1,
  "liked": true,
  "likeCount": 1,
  "message": "답글 좋아요 처리 성공"
}
```

`GET /api/fundings/:fundingId/questions` now returns reply like state:

```json
{
  "questionId": 1,
  "writerId": 2,
  "userId": 2,
  "writerNickname": "테스트소비자",
  "writerRole": "USER",
  "role": "USER",
  "isBrewery": false,
  "writerIsBrewery": false,
  "likeCount": 3,
  "liked": true,
  "replies": [
    {
      "replyId": 1,
      "writerId": 2,
      "userId": 2,
      "writerNickname": "테스트소비자",
      "writerRole": "USER",
      "role": "USER",
      "isBrewery": false,
      "writerIsBrewery": false,
      "content": "답글",
      "likeCount": 1,
      "liked": true,
      "createdAt": "2026-05-24T00:00:00.000Z"
    }
  ]
}
```

Writer fields are always the actual author from `users`, not the funding project's brewery name.

- General user question/reply: `writerRole: "USER"`, `isBrewery: false`
- Brewery account question/reply: `writerRole: "BREWERY"`, `isBrewery: true`
- Aliases also included where applicable: `writer_id`, `userId`, `user_id`, `role`, `writerIsBrewery`

## Brewery Log Comment/Reply Likes

Comment likes:

```http
POST /api/fundings/:fundingId/brewery-logs/:breweryLogId/comments/:commentId/likes
DELETE /api/fundings/:fundingId/brewery-logs/:breweryLogId/comments/:commentId/likes
```

Reply likes:

```http
POST /api/fundings/:fundingId/brewery-logs/:breweryLogId/comments/:commentId/replies/:replyId/likes
DELETE /api/fundings/:fundingId/brewery-logs/:breweryLogId/comments/:commentId/replies/:replyId/likes
```

Response:

```json
{
  "fundingId": 1,
  "breweryLogId": 1,
  "commentId": 1,
  "replyId": 2,
  "liked": true,
  "likeCount": 1,
  "message": "댓글 좋아요를 등록했습니다."
}
```

`GET /api/fundings/:fundingId/brewery-logs/:breweryLogId/comments` returns `likeCount`, `liked`, and actual writer fields for both comments and replies.

Writer fields:

```json
{
  "commentId": 1,
  "writerId": 2,
  "userId": 2,
  "writerNickname": "테스트소비자",
  "writerRole": "USER",
  "role": "USER",
  "isBrewery": false,
  "writerIsBrewery": false,
  "replies": [
    {
      "replyId": 2,
      "writerId": 2,
      "userId": 2,
      "writerNickname": "테스트소비자",
      "writerRole": "USER",
      "role": "USER",
      "isBrewery": false,
      "writerIsBrewery": false
    }
  ]
}
```

General user comment/reply returns `role=USER` and `isBrewery=false`. Brewery account comment/reply returns `role=BREWERY` and `isBrewery=true`.

## Review APIs

Review list:

```http
GET /api/fundings/:fundingId/reviews
```

Review detail:

```http
GET /api/fundings/:fundingId/reviews/:reviewId
```

Review responses include all writer id aliases so frontend can safely decide whether to show edit/delete buttons:

```json
{
  "reviewId": 1,
  "fundingId": 1,
  "writerId": 7,
  "writer_id": 7,
  "userId": 7,
  "user_id": 7,
  "writerNickname": "닉네임",
  "rating": 4,
  "content": "후기",
  "detailReview": "후기",
  "imageUrls": [],
  "mood": "기분",
  "pairing": "안주",
  "tags": ["달콤", "가벼움"],
  "recordVisibility": true,
  "showRecord": true,
  "createdAt": "2026-05-24T00:00:00.000Z",
  "updatedAt": "2026-05-24T00:00:00.000Z"
}
```

Delete review:

```http
DELETE /api/fundings/:fundingId/reviews/:reviewId
```

Response:

```json
{
  "reviewId": 1,
  "fundingId": 1,
  "writerId": 7,
  "writer_id": 7,
  "userId": 7,
  "user_id": 7,
  "deleted": true,
  "message": "후기가 삭제되었습니다."
}
```

Update review with images:

```http
PATCH /api/fundings/:fundingId/reviews/:reviewId
Content-Type: multipart/form-data
```

Fields:

- `rating`
- `content` or `detailReview`
- `images`: new image files, up to 5
- `imageUrls`: optional full image URL list to keep
- `tags`: optional JSON string array
- `deleteImageUrls`: optional JSON string array to remove

Example `deleteImageUrls` form field value:

```json
["https://example.com/remove.png"]
```

Response includes:

```json
{
  "reviewId": 1,
  "fundingId": 1,
  "writerId": 7,
  "writer_id": 7,
  "userId": 7,
  "user_id": 7,
  "rating": 4,
  "content": "수정 후기",
  "tags": ["산뜻함"],
  "imageUrls": ["https://example.com/keep.png", "https://.../new.png"]
}
```

Like/unlike review:

```http
POST /api/fundings/:fundingId/reviews/:reviewId/likes
DELETE /api/fundings/:fundingId/reviews/:reviewId/likes
```

Review list/detail/create/update/like responses include:

- `mood`
- `pairing`
- `tags`
- `recordVisibility`
- `showRecord`
- `likeCount`
- `liked`

Review like response:

```json
{
  "reviewId": 1,
  "fundingId": 1,
  "writerId": 7,
  "writerNickname": "닉네임",
  "rating": 5,
  "content": "후기",
  "mood": "행복",
  "pairing": "전",
  "tags": ["달콤", "꽃향"],
  "recordVisibility": false,
  "showRecord": false,
  "likeCount": 1,
  "liked": true
}
```

## Review Detail Comments

Review comments are DB-backed.

List comments:

```http
GET /api/fundings/:fundingId/reviews/:reviewId/comments
```

Create comment:

```http
POST /api/fundings/:fundingId/reviews/:reviewId/comments
Content-Type: application/json
```

Body:

```json
{
  "content": "댓글 내용"
}
```

Like/unlike comment:

```http
POST /api/fundings/:fundingId/reviews/:reviewId/comments/:commentId/likes
DELETE /api/fundings/:fundingId/reviews/:reviewId/comments/:commentId/likes
```

Comment response:

```json
{
  "commentId": 1,
  "fundingId": 1,
  "reviewId": 1,
  "writerId": 7,
  "writer_id": 7,
  "userId": 7,
  "user_id": 7,
  "writerNickname": "닉네임",
  "content": "댓글 내용",
  "likeCount": 1,
  "liked": true,
  "createdAt": "2026-05-24T00:00:00.000Z",
  "updatedAt": null
}
```

`GET` response wraps comments in `content`.

## Funding Likes

```http
POST /api/fundings/:fundingId/likes
DELETE /api/fundings/:fundingId/likes
```

The backend now resolves both real `fundingId` and submitted `draftId`.
Frontend should still prefer the real `fundingId` returned by submit/detail.

Response:

```json
{
  "fundingId": 22,
  "liked": true,
  "likeCount": 1
}
```

## Funding Stats

```http
GET /api/fundings/stats
```

Response includes both old and new amount units:

```json
{
  "participationAvailableFunding": 3,
  "totalSupporterCount": 12,
  "successfulProjectCount": 1,
  "totalRaisedAmount": 10000000,
  "totalRaisedHundredMillion": 0.1,
  "totalRaisedTenMillion": 1,
  "totalRaisedTenMillionUnit": "천만원"
}
```

프론트의 “총 n천만원 이상 모금 달성” 문구는 `totalRaisedTenMillion` 기준 사용을 권장합니다.

## Funding Reports

```http
POST /api/fundings/:fundingId/reports
Content-Type: application/json
```

Body:

```json
{
  "reason": "허위 정보",
  "content": "상세 신고 내용"
}
```

Accepted `reason` values:

- `허위 정보`
- `부적절한 내용`
- `저작권 침해`
- `사기 의심`
- `기타`

Response:

```json
{
  "reportId": 1,
  "fundingId": 22,
  "reporterId": 7,
  "reason": "FALSE_INFORMATION",
  "content": "상세 신고 내용",
  "status": "PENDING"
}
```

## Brewery Log Comments

```http
GET /api/fundings/:fundingId/brewery-logs/:breweryLogId/comments
POST /api/fundings/:fundingId/brewery-logs/:breweryLogId/comments
POST /api/fundings/:fundingId/brewery-logs/:breweryLogId/comments/:commentId/likes
DELETE /api/fundings/:fundingId/brewery-logs/:breweryLogId/comments/:commentId/likes
```

Create body:

```json
{
  "content": "댓글 내용"
}
```

Comment response includes:

- `commentId`
- `breweryLogId`
- `writerId`
- `writer_id`
- `userId`
- `user_id`
- `writerNickname`
- `writerRole`
- `role`
- `isBrewery`
- `writerIsBrewery`
- `content`
- `likeCount`
- `liked`
- `replies`
- `createdAt`
- `updatedAt`

## Brewery Application APIs

Current authenticated user's latest brewery application:

```http
GET /api/breweries/applications/me
```

Update current authenticated user's approved brewery information:

```http
PATCH /api/breweries/applications/me
Content-Type: application/json
```

Body fields are optional, but at least one is required:

```json
{
  "breweryName": "양조장명",
  "licenseNumber": "면허번호",
  "location": "[06236] 서울 강남구 테헤란로 152",
  "documentUrl": "https://...",
  "documentKey": "uploads/..."
}
```

Only the latest `APPROVED` application for the current user is updated. Pending/rejected application status UI can use `GET /api/breweries/applications/me` and display `data.status`.

## SulBTI Match Score

Funding list and detail now return these same 0~100 values:

- `sulbtiMatchScore`
- `matchScore`
- `tasteMatchScore`
- `matchRate`

If the current user has no SulBTI result or the funding has no taste profile, the value is `null`.

Current calculation:

- User SulBTI 1~5 scores are normalized to 0, 25, 50, 75, 100.
- Compared axes:
  - `sweetnessScore` ↔ funding `sweetness`
  - `bodyScore` ↔ funding `body`
  - `carbonationScore` ↔ funding `carbonation`
  - `abvScore` ↔ funding `alcoholIntensity`
- Score is the average axis similarity: `100 - absolute difference`.
- `flavorScore` is not used yet because funding has no direct flavor-score axis.

`sort=RECOMMENDED` orders by this match score descending.

## 17-Item Verification Summary

1. Brewery info load: verified DB-backed load for saved bank/account/business address.
2. Real phone verification: not implemented; needs SMS provider integration.
3. 1-won account verification: possible, but needs Open Banking/Firmbanking/account verification provider contract and API.
4. Address search: frontend-owned; backend stores formatted address string as-is. Verified.
5. Draft save/delete/load: verified for plan, video URL, budget, schedule, brewery files, and 5 required documents.
6. Submitted project detail/like: verified public detail reflects saved DB data and like works.
7. Manage/edit reload: detail/preview now return draft-backed data, documents, de-duplicated images, bank/account, representative, business type/category/item. Verified.
8. Funding stats: `GET /api/fundings/stats` added and verified.
9. Brewery log image: verified image URL fallback is returned instead of a broken/gray placeholder when S3 is unavailable.
10. Brewery log second comment input: backend accepts and stores multiple comments. If input focus still fails, that remaining symptom is frontend UI state.
11. Brewery log comments DB: verified multiple comments persist and return.
12. Q&A second reply input: backend accepts and stores multiple replies. If input focus still fails, that remaining symptom is frontend UI state.
13. Q&A like persistence: verified question and reply `liked`/`likeCount` return correctly after like/unlike.
14. Share/report: DB-backed share/report verified. A truly externally open share URL needs deployed `PUBLIC_WEB_BASE_URL`.
15. Reviews: title is no longer required. List/detail/create/update/delete include writer id aliases. PATCH supports multipart image add, JSON-string `tags`, and `deleteImageUrls`.
16. Sorting: verified API accepts `POPULAR`, `LATEST`, `DEADLINE`, `RECOMMENDED`. Popular sorts by like count, deadline by end date, latest by created date.
17. SulBTI match percent: implemented with deterministic taste-axis scoring. List/detail return `sulbtiMatchScore`, `matchScore`, `tasteMatchScore`, and `matchRate`.

## Main Remaining Backend/Infra Items

- Add real SMS verification provider.
- Add real 1-won account verification provider.
- Configure S3 bucket/IAM/read URL policy for production.
- Set `PUBLIC_WEB_BASE_URL` to deployed frontend/web URL for real share links.
- Define a future AI-based SulBTI recommendation source if the deterministic taste-axis score is not enough.
- Deploy/restart the backend after the auth fallback removal so the running server uses the updated writer identity logic.

## 2026-05-25 Post-Merge Verification

- Confirmed the connected DB is `judam`.
- Confirmed these migrations are already applied on the connected DB:
  - `database/20260524_funding_review_comments.sql`
  - `database/20260525_funding_review_likes.sql`
- Confirmed these review persistence tables exist:
  - `funding_review_comments`
  - `funding_review_comment_likes`
  - `funding_review_likes`
- Confirmed the required indexes for review comments/comment likes/review likes exist.
- Confirmed `GET /api/fundings/drafts/by-funding/:fundingId` is routed and returns the same preview-shaped payload used by manage/edit.
- Confirmed `basicInfo.allImageUrls` is built with duplicate removal and should be used as the manage/edit gallery source.
- Confirmed review like/unlike routes are available:
  - `POST /api/fundings/:fundingId/reviews/:reviewId/likes`
  - `DELETE /api/fundings/:fundingId/reviews/:reviewId/likes`
- Confirmed review like/unlike responses include `liked` and `likeCount` through the review response mapper.
- Deleted remaining exact-title `test` funding rows from `judam`: funding projects 3 rows and linked drafts 2 rows. Remaining exact-title `test` count is 0.
- Added and applied `database/20260525_funding_bank_account_verifications.sql`.
- Added account verification request/confirm APIs:
  - `POST /api/fundings/bank-account/verification`
  - `POST /api/fundings/bank-account/verification/confirm`
- Updated legacy draft account verification so it requires a confirmed `bankVerificationToken` instead of immediately marking the account verified.
- Confirmed funding detail `imageUrls` and `allImageUrls` are returned as arrays.
- Added actual writer fields to Q&A question/reply responses and brewery log comment/reply responses: `writerId`, `userId`, `writerNickname`, `writerRole`, `role`, `isBrewery`, `writerIsBrewery`.
- Verified with a normal `USER` account that Q&A and brewery log comments/replies return the user's nickname/role and `isBrewery=false`.
- `node --check src/controllers/funding.controller.js` and `node --check src/routes/fundingRoutes.js` passed after merge.

## 2026-05-26 Funding Flow Recheck

### Auth And Liked

- Funding routes now use optional auth.
- If `Authorization: Bearer {token}` is present and valid, `req.user.userId` is used.
- If no `Authorization` header is present, public GET APIs still work, but user-specific `liked` returns `false`.
- Comment/reply/like/review/order write APIs no longer use the old `userId=1` fallback.
- Write APIs that need a user return `401 로그인이 필요합니다.` when no valid token/user is present.

### Manage/Edit Load

Verified with temporary linked `funding_project + funding_draft + documents 5종` data and cleaned it up afterward.

```http
GET /api/fundings/drafts/by-funding/:fundingId
```

Confirmed response includes DB values for:

- `basicInfo.thumbnailUrl`
- `basicInfo.imageUrls`
- `basicInfo.allImageUrls`
- `plan.videoUrl`
- `plan.budgetPlan`
- `plan.schedulePlan`
- `breweryInfo.bankName`
- `breweryInfo.accountNumber`
- `breweryInfo.accountHolder`
- `breweryInfo.representativeName`
- `breweryInfo.businessType`
- `breweryInfo.businessName`
- `breweryInfo.businessCategory`
- `breweryInfo.businessItem`
- `documents` 5 required types

Confirmed image policy:

- `basicInfo.imageUrls`: array, representative image excluded
- `basicInfo.allImageUrls`: array, representative image included, duplicates removed

Confirmed document types:

- `ID_CARD`
- `BUSINESS_LICENSE`
- `SALES_PERMIT`
- `ALCOHOL_PERMIT`
- `MANUFACTURING_LICENSE`

### Public Detail

```http
GET /api/fundings/:fundingId
```

Confirmed registered draft-backed values are returned in public detail:

- `category`
- `mainIngredient`
- `legalInfo`
- `tasteProfile`
- `plan`
- `breweryInfo`
- `notices`
- `documents`
- `allImageUrls`

Public detail now falls back to linked draft values where the public funding row is missing draft-only fields.

### Writer Identity

Q&A question/reply, brewery log comment/reply, and review comment responses include actual writer fields from `users`:

```json
{
  "writerId": 2,
  "userId": 2,
  "writerNickname": "테스트소비자",
  "writerProfileImage": null,
  "writerRole": "USER",
  "role": "USER",
  "isBrewery": false,
  "writerIsBrewery": false
}
```

- General users return `role=USER`, `isBrewery=false`.
- Brewery-role users return `isBrewery=true` when `role` starts with `BREWERY`.
- Writer nickname/profile comes from `users.nickname` and `users.profile_image`, not from the project brewery name.
- Writer nickname fallback is now only `users.nickname -> "사용자"`. It does not fall back to `funding_projects.brewery_user_id`, `brewery_auth.brewery_name`, or the project brewery name.
- Existing old rows that were already saved with the wrong `user_id` will still display that saved user. New writes save `req.user.userId`.

### Rechecked APIs

- `POST /api/fundings/:fundingId/questions`
- `POST /api/fundings/:fundingId/questions/:questionId/replies`
- `GET /api/fundings/:fundingId/questions`
- `POST /api/fundings/:fundingId/brewery-logs/:breweryLogId/comments`
- `POST /api/fundings/:fundingId/brewery-logs/:breweryLogId/comments/:commentId/replies`
- `GET /api/fundings/:fundingId/brewery-logs/:breweryLogId/comments`
- `POST /api/fundings/:fundingId/reviews/:reviewId/comments`
- `GET /api/fundings/:fundingId/reviews/:reviewId/comments`
- `POST /api/fundings/:fundingId/reports`
- `POST /api/fundings/:fundingId/likes`
- `DELETE /api/fundings/:fundingId/likes`

Smoke test data cleanup confirmed 0 rows remaining for the temporary test markers.
