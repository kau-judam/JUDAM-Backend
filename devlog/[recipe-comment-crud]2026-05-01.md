# 일일 보고서

* 날짜 : 5월 1일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : feature/recipe-comment-crud

---

### 작업 1 — 브랜치 생성 및 `RECIPE_COMMENTS` 테이블 구조 파악

`dev` 브랜치에서 최신 내용을 받고 `feature/recipe-comment-crud` 브랜치를 새로 만들었다.

레시피 댓글을 저장할 `RECIPE_COMMENTS` 테이블의 구조는 아래와 같다 (API 주차별 계획서에 정의된 DDL 기준).

```sql
CREATE TABLE "RECIPE_COMMENTS" (
    "comment_id"  BIGSERIAL  NOT NULL,
    "recipe_id"   BIGINT     NOT NULL,  -- FK → RECIPES
    "user_id"     BIGINT     NOT NULL,  -- FK → USERS
    "content"     TEXT       NOT NULL,
    "like_count"  INT        NOT NULL DEFAULT 0,
    "created_at"  TIMESTAMP  NOT NULL,
    "updated_at"  TIMESTAMP  NULL,
    CONSTRAINT PK_RECIPE_COMMENTS PRIMARY KEY ("comment_id")
);
```

---

### 작업 2 — `GET /api/recipes/:recipeId/comments` 댓글 목록 조회 구현

**이 API가 하는 일**: 특정 레시피에 달린 댓글 목록을 페이지 단위로 반환한다.

**로그인 여부에 따라 is_liked가 달라진다**
- 로그인한 사용자: 해당 댓글에 내가 좋아요를 눌렀는지 여부(`is_liked`)가 실제 값으로 반영
- 비로그인 사용자: `is_liked`는 무조건 `false`

이를 위해 `authMiddleware`를 붙이지 않고, 컨트롤러 안에서 직접 `Authorization` 헤더를 선택적으로 파싱하는 방식을 사용했다. 헤더가 없거나 토큰이 만료되어도 목록 조회 자체는 허용한다.

**쿼리 파라미터**

| 파라미터 | 설명 | 기본값 |
|---|---|---|
| `page` | 페이지 번호 (0부터 시작) | 0 |
| `size` | 한 페이지당 항목 수 | 20 |

**응답 구조**

```json
{
  "comments": [
    {
      "comment_id": 1,
      "user_nickname": "막걸리덕후",
      "content": "복숭아 막걸리 정말 기대됩니다!",
      "like_count": 5,
      "is_liked": false,
      "created_at": "2026-04-30T10:00:00.000Z",
      "updated_at": null
    }
  ],
  "totalElements": 2,
  "totalPages": 1,
  "currentPage": 0
}
```

**에러 케이스**
- 존재하지 않는 `recipeId` 요청 → 404

---

### 작업 3 — `POST /api/recipes/:recipeId/comments` 댓글 작성 구현

**이 API가 하는 일**: 로그인한 사용자가 특정 레시피에 댓글을 작성한다.

**로그인 필수** — `authMiddleware`가 JWT 토큰을 검증하고, 통과하면 `req.user`에 사용자 정보(`id`, `email`)를 담아준다.

**요청 바디**

```json
{ "content": "오늘 만들어봤는데 정말 맛있었어요!" }
```

**응답 구조**

```json
{
  "status": 201,
  "message": "댓글이 등록되었습니다.",
  "comment": {
    "comment_id": 3,
    "user_nickname": "막걸리덕후",
    "content": "오늘 만들어봤는데 정말 맛있었어요!",
    "like_count": 0,
    "created_at": "2026-05-01T18:00:45.525Z",
    "updated_at": null
  }
}
```

**에러 케이스**
- `content` 없거나 빈 문자열 → 400
- 존재하지 않는 `recipeId` → 404
- 토큰 없음/만료 → 401 (authMiddleware에서 처리)

---

### 작업 4 — 로컬 테스트 완료

서버를 실행해서 아래 케이스를 직접 확인.

| 테스트 | 결과 |
|---|---|
| `GET /api/recipes/1/comments` (비로그인) | 200, 댓글 2개, is_liked = false |
| `POST /api/recipes/1/comments` (로그인, 댓글 작성) | 201, 새 댓글 반환 |
| `GET /api/recipes/1/comments` (작성 후 다시 조회) | 200, 댓글 3개 |
| `GET /api/recipes/999/comments` (없는 레시피) | 404 |
| `POST /api/recipes/1/comments` (content 없음) | 400 |

---

### 새로 생성한 파일

| 파일 | 역할 |
|---|---|
| `src/services/recipeCommentService.js` | 댓글 CRUD 로직 (MOCK 데이터 포함) |
| `src/controllers/recipeCommentController.js` | 댓글 요청 핸들러 |

### 수정한 파일

| 파일 | 변경 내용 |
|---|---|
| `src/routes/recipeRoutes.js` | 댓글 4개 엔드포인트 추가 (GET/POST/PUT/DELETE) |

---

### 세부사항

**닉네임 반환 방식 (임시방편)**

JWT 페이로드에는 `id`와 `email`만 담겨 있고 `nickname`이 없다. 댓글 목록 응답에는 작성자 닉네임이 필요하기 때문에, 지금은 `recipeCommentService.js` 안에 `MOCK_USER_NICKNAMES = { 1: '막걸리덕후', 2: '전통주마니아' }` 형태의 고정 매핑을 임시로 사용하고 있다.

나중에 AWS RDS가 연결되면, 댓글 작성 시 `USERS` 테이블에서 `user_id`로 닉네임을 조회하거나, JWT 발급 시 `nickname`도 페이로드에 포함하는 방식으로 교체해야 한다. `recipeCommentService.js`의 `MOCK_USER_NICKNAMES` 상수와 `createComment` 함수의 닉네임 조회 로직을 수정하면 된다.

**댓글 수정/삭제는 내일(5/2) 연결 예정**

`recipeCommentService.js`에 `updateComment`와 `deleteComment` 함수는 이미 구현해 두었고, `recipeCommentController.js`의 `putComment`와 `deleteCommentHandler`, 그리고 `recipeRoutes.js`의 PUT/DELETE 라우트도 모두 등록되어 있다. 내일(5/2) 계획된 작업에서 그대로 사용하면 된다.
