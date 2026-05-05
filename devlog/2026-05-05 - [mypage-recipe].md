# 일일 보고서

* 날짜 : 5월 5일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : feature/mypage-recipe

---

### 작업 1 — `feature/mypage-recipe` 브랜치 생성 및 JWT 인증 방식 파악

**브랜치 생성 흐름**

`dev` 브랜치를 최신화한 뒤 `feature/mypage-recipe` 브랜치를 생성했다.

```bash
git checkout dev
git pull origin dev
git checkout -b feature/mypage-recipe
```

**JWT 인증 방식 파악**

마이페이지는 "현재 로그인한 사람"의 데이터를 돌려줘야 하기 때문에, 서버가 어떻게 요청자를 알아내는지 파악하는 게 먼저였다.

기존 코드를 살펴보니 흐름은 아래와 같다.

1. 클라이언트가 `Authorization: Bearer <토큰>` 헤더를 붙여서 요청을 보낸다.
2. `authMiddleware.js`가 토큰을 검증하고, 토큰 안에 들어있는 사용자 정보를 `req.user`에 담아준다.
3. 컨트롤러에서는 `req.user.id`로 현재 로그인한 사용자의 ID를 꺼내 쓰면 된다.

기존 레시피 컨트롤러들이 모두 `const userId = req.user.id;` 패턴을 사용하고 있어서, 오늘 구현도 동일하게 따랐다.

---

### 작업 2 — `GET /api/users/me/recipes` 구현 (내가 작성한 레시피 목록)

**이 API가 하는 일**: 현재 로그인한 사용자가 직접 작성한 레시피 목록을 반환한다.

**핵심 로직**

- `recipes` 테이블에서 `user_id = 현재 사용자 ID` 조건으로 필터링
- 정렬: 최신 작성순 (`created_at DESC`)
- 페이지네이션: `page`, `size` 쿼리 파라미터 지원 (기본값 page=0, size=20)

**응답 구조**

```json
{
  "recipes": [
    {
      "recipe_id": 42,
      "title": "달콤한 복숭아 막걸리",
      "summary": "복숭아향 가득한 달콤한 저도수 막걸리",
      "main_ingredient": "쌀, 복숭아",
      "status": "FUNDING_READY",
      "is_fundable": true,
      "interest_count": 105,
      "image_url": "https://cdn.example.com/recipes/42.png",
      "created_at": "2026-04-27T10:30:00"
    }
  ],
  "totalElements": 1,
  "totalPages": 1,
  "currentPage": 0
}
```

---

### 작업 3 — `GET /api/users/me/interests/recipes` 구현 (내가 관심 등록한 레시피 목록)

**이 API가 하는 일**: 현재 로그인한 사용자가 관심(좋아요) 등록한 레시피 목록을 반환한다.

**핵심 로직**

- `recipe_interests` 테이블에서 `user_id = 현재 사용자 ID`인 행을 찾고, `recipes` 테이블과 JOIN
- 정렬: 최근 관심 등록순 (`recipe_interests.created_at DESC`)
- 응답에 `interested_at` 필드 포함 (관심 등록 일시)
- 내 레시피 목록과 달리 `author_type`도 응답에 포함 (누가 올린 레시피인지 프론트에서 구분 필요)

**응답 구조**

```json
{
  "recipes": [
    {
      "recipe_id": 42,
      "title": "달콤한 복숭아 막걸리",
      "summary": "복숭아향 가득한 달콤한 저도수 막걸리",
      "main_ingredient": "쌀, 복숭아",
      "author_type": "USER",
      "status": "FUNDING_READY",
      "is_fundable": true,
      "interest_count": 105,
      "image_url": "https://cdn.example.com/recipes/42.png",
      "interested_at": "2026-04-28T09:00:00"
    }
  ],
  "totalElements": 1,
  "totalPages": 1,
  "currentPage": 0
}
```

---

### 작업 4 — `GET /api/users/me/recipe-comments` 구현 (내가 작성한 레시피 댓글 목록)

**이 API가 하는 일**: 현재 로그인한 사용자가 작성한 레시피 댓글 목록을 반환한다. 각 댓글에는 그 댓글이 달린 레시피 정보가 함께 포함된다.

**핵심 로직**

- `recipe_comments` 테이블에서 `user_id = 현재 사용자 ID`인 댓글 조회
- `recipes` 테이블과 JOIN해서 댓글이 달린 레시피의 `recipe_id`, `title`, `status`를 함께 반환
- `json_build_object()`로 `recipe` 필드를 중첩 객체로 구성
- 정렬: 최신 작성순 (`recipe_comments.created_at DESC`)

**응답 구조**

```json
{
  "comments": [
    {
      "comment_id": 77,
      "content": "이 레시피 정말 만들어보고 싶네요!",
      "like_count": 3,
      "created_at": "2026-04-30T14:20:00",
      "updated_at": null,
      "recipe": {
        "recipe_id": 42,
        "title": "달콤한 복숭아 막걸리",
        "status": "FUNDING_READY"
      }
    }
  ],
  "totalElements": 1,
  "totalPages": 1,
  "currentPage": 0
}
```

---

### 작업 5 — 신규 파일 생성 및 라우트 연결

**새로 만든 파일**

| 파일 | 역할 |
|---|---|
| `src/services/mypageService.js` | DB 쿼리 3개 (내 레시피 / 관심 레시피 / 내 댓글) |
| `src/controllers/mypageController.js` | 핸들러 3개, req.user.id로 사용자 식별 |

**수정한 파일**

| 파일 | 변경 내용 |
|---|---|
| `src/routes/userRoutes.js` | 라우트 3개 추가 (`authMiddleware` 적용) |
| `app.js` | 마운트 경로 `/users` → `/api/users` 수정 (API 스펙 경로 일치) |

`app.js`의 마운트 경로가 `/users`로 되어 있어 API 스펙의 `/api/users/me/...`와 맞지 않았다. `/api/users`로 수정하면서 기존 `/users/me` 플레이스홀더 엔드포인트도 `/api/users/me`로 자연스럽게 이동됐다.

---

### 참고사항

- `recipeCommentController.js`의 댓글 수정·삭제 권한 검사(`putComment`, `deleteCommentHandler`)에서 `comment.user_id !== req.user.id` 비교 시 타입 불일치 버그가 있었다. DB에서 반환되는 `comment.user_id`는 숫자형인데 JWT에서 추출한 `req.user.id`는 문자열로 들어오는 경우가 있어 `!==` 엄격 비교가 항상 `true`를 반환하는 문제였다. `Number(req.user.id)`로 명시적 형변환을 추가하여 수정했다. (`feature/s3-presigned-url` 브랜치에서 함께 수정)

- S3 Presigned URL을 이용한 이미지 업로드 API를 `feature/s3-presigned-url` 브랜치에서 추가 구현했다. `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` 패키지가 추가됐으며, `src/services/s3.service.js` / `src/controllers/s3.controller.js` / `src/routes/s3.routes.js` 파일이 신규 생성됐다. AWS 관련 환경변수(`AWS_REGION`, `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)는 `.env.example`에 추가됐으며, 실제 `.env`에도 값을 채워야 S3 기능이 동작한다.

- `app.js`의 userRoutes 마운트 경로를 `/users` → `/api/users`로 수정했다(작업 5 참조). 이 변경으로 기존에 `/users/...` 경로로 테스트하던 클라이언트나 팀원이 있다면 `/api/users/...`로 경로를 업데이트해야 한다.
