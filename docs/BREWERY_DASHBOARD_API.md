# Brewery Dashboard API

Last updated: 2026-05-28

All APIs require:

```http
Authorization: Bearer {accessToken}
```

The authenticated user must be a brewery account or have an approved brewery application.

## Implementation Status

- These APIs are DB-backed. They do not use local memory or mock data.
- Applied to the connected `judam` DB on 2026-05-28:
  - `database/20260528_brewery_dashboard_profile_notifications.sql`
- Smoke tested against `judam` with temporary data, then removed the temporary rows.
- If another server, staging DB, or production DB has not applied this migration yet, these APIs will not work there until the migration is applied.

## Database Tables

The migration creates:

### `brewery_profiles`

Stores editable brewery dashboard profile fields separately from the brewery verification source table.

- `profile_id`
- `user_id`
- `application_id`
- `profile_image_url`
- `brewery_name`
- `one_line_introduction`
- `short_introduction`
- `brand_story`
- `history`
- `established_year`
- `representative_name`
- `address`
- `contact_email`
- `created_at`
- `updated_at`

### `brewery_dashboard_notifications`

Stores brewery dashboard notifications and read state.

- `notification_id`
- `user_id`
- `type`
- `title`
- `content`
- `link_url`
- `image_url`
- `is_read`
- `read_at`
- `created_at`
- `updated_at`

`brewery_auth` remains the verification source for read-only values:

- `license_number` -> `businessRegistrationNumber`
- `phone_number` -> `phoneNumber`
- `business_address_detail` -> dashboard `addressDetail`

## Profile

### Get My Brewery Profile

```http
GET /api/breweries/me/profile
```

Response:

```json
{
  "profileImageUrl": "https://example.com/brewery.png",
  "breweryName": "주담양조장",
  "oneLineIntroduction": "우리 술을 새롭게 빚습니다.",
  "shortIntroduction": "서울에서 전통주를 만드는 양조장입니다.",
  "brandStory": "브랜드 스토리",
  "history": "2020 설립\n2024 주담 입점",
  "establishedYear": 2020,
  "representativeName": "홍길동",
  "address": "[06236] 서울 강남구 테헤란로 152",
  "businessRegistrationNumber": "123-45-67890",
  "phoneNumber": "010-1234-5678",
  "email": "brewery@example.com",
  "isVerified": true
}
```

### Update My Brewery Profile

```http
PATCH /api/breweries/me/profile
Content-Type: application/json
```

Editable fields:

```json
{
  "profileImageUrl": "https://example.com/brewery.png",
  "breweryName": "주담양조장",
  "oneLineIntroduction": "우리 술을 새롭게 빚습니다.",
  "shortIntroduction": "서울에서 전통주를 만드는 양조장입니다.",
  "brandStory": "브랜드 스토리",
  "history": "2020 설립\n2024 주담 입점",
  "establishedYear": 2020,
  "representativeName": "홍길동",
  "address": "[06236] 서울 강남구 테헤란로 152",
  "email": "brewery@example.com"
}
```

Response is the same shape as `GET /api/breweries/me/profile`.

Read-only fields:

- `businessRegistrationNumber`
- `phoneNumber`
- `isVerified`

`email` is stored as brewery contact email. It does not change the login account email.

`profileImageUrl` can be updated directly as a string URL through this JSON endpoint, or uploaded through the multipart endpoint below.

### Upload My Brewery Profile Image

```http
PATCH /api/breweries/me/profile/image
Content-Type: multipart/form-data
```

Accepted file field names:

- `image` recommended
- `profileImage`
- `file`

Allowed file types:

- `image/jpeg`
- `image/png`
- `image/webp`

Max file size:

- 5MB

Response:

```json
{
  "profileImageUrl": "https://example.com/brewery.png",
  "profile": {
    "profileImageUrl": "https://example.com/brewery.png",
    "breweryName": "주담양조장",
    "oneLineIntroduction": "우리 술을 새롭게 빚습니다.",
    "shortIntroduction": "서울에서 전통주를 만드는 양조장입니다.",
    "brandStory": "브랜드 스토리",
    "history": "2020 설립\n2024 주담 입점",
    "establishedYear": 2020,
    "representativeName": "홍길동",
    "address": "[06236] 서울 강남구 테헤란로 152",
    "businessRegistrationNumber": "123-45-67890",
    "phoneNumber": "010-1234-5678",
    "email": "brewery@example.com",
    "isVerified": true
  }
}
```

Storage behavior:

- The uploaded file is uploaded through the backend S3 uploader.
- The returned URL is saved to `brewery_profiles.profile_image_url`.
- If S3 upload fails and `FILE_UPLOAD_STRICT_S3` is not `true`, local/test fallback stores a data URL so development testing can continue.
- In production, set `FILE_UPLOAD_STRICT_S3=true` and configure S3 permissions/read policy so failed uploads are not silently accepted.

## Dashboard Basic Info

### Get Dashboard Basic Info

Used by the top basic information card on the brewery dashboard.

```http
GET /api/breweries/me/dashboard/basic-info
```

Response:

```json
{
  "breweryName": "코코양조장",
  "profileImageUrl": "https://example.com/brewery.png",
  "address": "[10357] 경기 고양시 일산동구 산두로229번길 18-10",
  "addressDetail": "1층"
}
```

Data source:

- `breweryName` -> latest approved `brewery_auth.brewery_name`
- `profileImageUrl` -> `brewery_profiles.profile_image_url`
- `address` -> latest approved `brewery_auth.location`
- `addressDetail` -> latest approved `brewery_auth.business_address_detail`

## Funding Summary

### Get Dashboard Funding Summary

Used by the brewery dashboard funding status statistics cards.

```http
GET /api/breweries/me/dashboard/funding-summary
```

Response:

```json
{
  "activeFundingCount": 2,
  "totalFundingCount": 5,
  "totalParticipantCount": 37
}
```

Data source:

- `funding_projects`
- `orders`

Aggregation rules:

- `activeFundingCount`: current user's `funding_projects` where `status IN ('ONGOING', 'ACTIVE')` and `end_date >= CURRENT_DATE`.
- `totalFundingCount`: all `funding_projects` where `brewery_user_id` is the authenticated user.
- `totalParticipantCount`: distinct paid order users across the authenticated user's fundings.
- Paid orders are counted from `orders.order_status = 'PAID'`.

Migration:

- No new migration is required for this endpoint.
- It uses existing `funding_projects.brewery_user_id`, `funding_projects.status`, `funding_projects.end_date`, `orders.funding_id`, `orders.user_id`, and `orders.order_status`.

## Funding List

### Get Dashboard Fundings

Used by the brewery dashboard funding status list and the journal management button.

```http
GET /api/breweries/me/dashboard/fundings?status=active&page=0&size=3
GET /api/breweries/me/dashboard/fundings?status=completed&page=0&size=3
```

Query parameters:

- `status`: required. `active` or `completed`
- `page`: optional. 0-based page number. Default `0`
- `size`: optional. Page size. Default `10`, max `100`

Response:

```json
{
  "content": [
    {
      "fundingId": 1,
      "title": "코코 시그니처 막걸리",
      "breweryName": "코코양조장",
      "thumbnailUrl": "https://example.com/funding-thumbnail.jpg",
      "currentAmount": 1680000,
      "targetAmount": 3000000,
      "achievementRate": 56,
      "status": "진행 중",
      "remainingDays": 12,
      "endDate": "2026-06-08"
    }
  ],
  "data": [
    {
      "fundingId": 1,
      "title": "코코 시그니처 막걸리",
      "breweryName": "코코양조장",
      "thumbnailUrl": "https://example.com/funding-thumbnail.jpg",
      "currentAmount": 1680000,
      "targetAmount": 3000000,
      "achievementRate": 56,
      "status": "진행 중",
      "remainingDays": 12,
      "endDate": "2026-06-08"
    }
  ],
  "page": 0,
  "size": 3,
  "totalElements": 1,
  "totalPages": 1
}
```

Frontend can use either `content` or `data`.

Status filter rules:

- `active`: scheduled/approved/active/ongoing/goal-achieved fundings whose `end_date` has not passed.
- `completed`: ended/successful/failed/production/shipping/completed fundings, or fundings whose `end_date` has passed.

Returned `status` is a Korean display label:

- `펀딩 예정`
- `진행 중`
- `목표 달성`
- `펀딩 성공`
- `펀딩 실패`
- `제작 중`
- `배송 중`
- `완료`

Field notes:

- `fundingId`: use for funding detail and `/brewery/project/{fundingId}/journal` navigation.
- `achievementRate`: integer percent for text/progress bar.
- `remainingDays`: non-negative integer. Completed fundings can be shown as `종료` on the frontend.
- `thumbnailUrl`: uses `funding_projects.thumbnail_url`, then first `funding_projects.image_urls`, then recipe image fallback.

Migration:

- No new migration is required for this endpoint.
- It uses existing `funding_projects`, `recipes`, `brewery_profiles`, and `brewery_auth`.

## Notifications

### Get Dashboard Notifications

```http
GET /api/breweries/me/dashboard/notifications
```

Response:

```json
{
  "notifications": [
    {
      "notificationId": 1,
      "type": "FUNDING_CREATED",
      "title": "새 펀딩이 등록되었습니다.",
      "content": "펀딩 프로젝트가 등록되었습니다.",
      "createdAt": "2026-05-28T10:00:00.000Z",
      "isRead": false,
      "linkUrl": "/fundings/1",
      "imageUrl": "https://example.com/funding.png"
    }
  ],
  "content": [
    {
      "notificationId": 1,
      "type": "FUNDING_CREATED",
      "title": "새 펀딩이 등록되었습니다.",
      "content": "펀딩 프로젝트가 등록되었습니다.",
      "createdAt": "2026-05-28T10:00:00.000Z",
      "isRead": false,
      "linkUrl": "/fundings/1",
      "imageUrl": "https://example.com/funding.png"
    }
  ],
  "unreadCount": 1
}
```

Frontend can use either `notifications` or `content`.

Notification type values:

- `FUNDING_CREATED`
- `FUNDING_PROGRESS`
- `FUNDING_ENDED`
- `FUNDING_SUCCESS`
- `RECIPE_POPULAR`

### Mark One Notification As Read

```http
PATCH /api/notifications/:notificationId/read
```

Response:

```json
{
  "notificationId": 1,
  "type": "FUNDING_CREATED",
  "title": "새 펀딩이 등록되었습니다.",
  "content": "펀딩 프로젝트가 등록되었습니다.",
  "createdAt": "2026-05-28T10:00:00.000Z",
  "isRead": true,
  "linkUrl": "/fundings/1",
  "imageUrl": "https://example.com/funding.png"
}
```

### Mark All Notifications As Read

```http
PATCH /api/notifications/read-all
```

Response:

```json
{
  "updatedCount": 3,
  "message": "전체 알림을 읽음 처리했습니다."
}
```

Scope:

- Only notifications with `user_id` equal to the authenticated user are updated.
- Other users' notifications are not affected.

## Database

Migration file:

```text
database/20260528_brewery_dashboard_profile_notifications.sql
```

Current connected `judam` DB status:

- Applied.
- `brewery_profiles` exists.
- `brewery_dashboard_notifications` exists.
- Rechecked on 2026-05-28 against `current_database() = judam`, `current_user = judam_jaewon`.
- Missing required dashboard tables/columns: none.
- Confirmed dashboard constraints/indexes:
  - `chk_brewery_dashboard_notifications_type`
  - `fk_brewery_dashboard_notifications_user`
  - `fk_brewery_profiles_user`
  - `uq_brewery_profiles_user`
  - `idx_brewery_dashboard_notifications_user_created`
  - `idx_brewery_dashboard_notifications_user_read`
  - `idx_brewery_profiles_user`

Production/staging status:

- Apply the same migration there before frontend testing against that environment.
