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

`profileImageUrl` is a string URL field. This endpoint does not accept image multipart upload.
If the frontend needs to upload a new image file, upload it through an upload API/S3 flow first and send the returned URL as `profileImageUrl`.

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
- `profileImageUrl` -> latest approved `brewery_auth.profile_image_url`
- `address` -> latest approved `brewery_auth.location`
- `addressDetail` -> latest approved `brewery_auth.business_address_detail`

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

Production/staging status:

- Apply the same migration there before frontend testing against that environment.
