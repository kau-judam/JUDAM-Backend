# 일일 보고서

* 날짜 : 5월 29일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : feature/post-comment-crud

---

### 작업 0 — 브랜치 생성 및 작업 범위 확정

13주차 첫 작업으로 **게시글 댓글 CRUD**를 시작했다. 이번 브랜치는 댓글 CRUD 4개(GET/POST/PUT/DELETE)를 한꺼번에 묶는 단위라서 `feature/post-comment-crud`로 생성. 13주차 첫째날(5/29)에는 GET·POST 2개까지 완료하는 것이 DailyToDo 계획.

dev 최신화 시 다른 세션에서 AI 관련 변경(`ai.controller.js`, `ai.routes.js`, `ai.service.js`)이 들어와 fast-forward로 머지됐고, 댓글 작업과 충돌은 없다.

---

### 작업 1 — DailyToDo 13주차 계획 vs API 명세서 충돌점 검토

구현 시작 전, `01.CommonRules/DailyToDo/[커뮤니티]13주차 계획.md`와 `00.DefaultContext/API 문서/13주차/`의 명세서를 대조했다. **API 명세서가 프론트에 공개된 최신 문서이므로 충돌 시 항상 명세서를 기준으로 구현**한다는 원칙은 12주차에 이어 동일.

| 항목 | DailyToDo | API 명세서 | 처리 |
|---|---|---|---|
| ALTER 추가 컬럼 | `like_count`, `updated_at` 2개 | 명세서 메모에 **`parent_comment_id BIGINT NULL + 자기참조 FK`도 "DB 선결 — 별도 협의" 명시** | **명세서대로 3개 모두 추가** — 명세서 쿼리에 `WHERE parent_comment_id IS NULL`과 `reply_count` 서브쿼리가 들어 있어 컬럼이 없으면 명세서 구현 불가, 14주차 대댓글 작성에도 어차피 필요 |
| GET 정렬 | 명시 없음 | `created_at` 오름차순(오래된 댓글 먼저) | 명세서대로 |
| GET 응답 페이지네이션 | 명시 없음 | `comments[]` + `totalElements` + `totalPages` + `currentPage` | 명세서대로 |
| 댓글 작성 후 카운트 | `POSTS.comment_count` +1 | `POSTS.comment_count` +1 | 일치 — 트랜잭션으로 처리 |

`schema.sql`의 `post_comments` 테이블에는 이미 `like_count`, `updated_at`이 정의되어 있고 `parent_comment_id`만 빠져 있었다. 운영 RDS에 누락된 환경을 대비해 마이그레이션에는 3개 컬럼 모두 `IF NOT EXISTS`로 안전하게 추가.

---

### 작업 2 — `post_comments` 테이블 마이그레이션 작성

**파일**: `database/20260529_add_post_comments_parent_comment_id.sql`

```sql
ALTER TABLE post_comments
  ADD COLUMN IF NOT EXISTS like_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS parent_comment_id BIGINT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_post_comments_parent'
  ) THEN
    ALTER TABLE post_comments
      ADD CONSTRAINT fk_post_comments_parent
      FOREIGN KEY (parent_comment_id)
      REFERENCES post_comments(comment_id)
      ON DELETE CASCADE;
  END IF;
END $$;
```

PostgreSQL은 `ADD CONSTRAINT IF NOT EXISTS`를 지원하지 않아 `pg_constraint` 조회 후 분기. `schema.sql`도 `parent_comment_id` + FK가 포함되도록 일관성 동기화.

**운영 RDS 반영은 사용자가 DBeaver/psql로 직접 실행 예정.**

---

### 작업 3 — `GET /api/posts/:postId/comments` 댓글 목록 조회 구현

**이 API가 하는 일**: 특정 게시글의 댓글을 페이지네이션으로 반환한다. 로그인하지 않아도 누구나 볼 수 있고, 로그인한 경우 본인의 좋아요 여부와 본인 댓글 여부가 함께 반환된다.

**쿼리 파라미터**
- `page` (기본 0), `size` (기본 20)

**응답 구조** — 명세서 기준

```json
{
  "comments": [
    {
      "comment_id": 201,
      "user_id": 8,
      "nickname": "전통주러버",
      "author_profile_image": "https://...",
      "content": "저도 마셔봤는데 정말 맛있었어요!",
      "like_count": 5,
      "reply_count": 2,
      "is_liked": true,
      "is_mine": false,
      "created_at": "2026-05-30T09:00:00",
      "updated_at": null
    }
  ],
  "totalElements": 1,
  "totalPages": 1,
  "currentPage": 0
}
```

**쿼리 구조** (recipe_comments 패턴 차용)
- `post_comments pc JOIN users u` — `nickname`, `author_profile_image` 획득
- `LEFT JOIN post_comment_likes pcl ON pcl.comment_id = pc.comment_id AND pcl.user_id = $4` — `is_liked` 판단
- `SELECT COUNT(*) FROM post_comments WHERE parent_comment_id = pc.comment_id` 서브쿼리 — `reply_count` (대댓글 작성 API 미구현 동안에는 항상 0)
- `WHERE pc.post_id = $1 AND pc.parent_comment_id IS NULL` — 루트 댓글만
- `ORDER BY pc.created_at ASC` — 오래된 댓글 먼저
- 별도 `COUNT(*)` 쿼리 — `totalElements` 산출

**비로그인 처리**: `optionalAuthMiddleware`로 토큰이 없으면 `req.user = null`. SQL의 `CASE WHEN pc.user_id = $4`와 LEFT JOIN 조건의 `pcl.user_id = $4`에 null이 들어가면 자연스럽게 `is_mine = false`, `is_liked = false` 반환.

**404 처리**: 서비스 진입 시 `SELECT 1 FROM posts WHERE post_id = $1` 단건 조회로 게시글 존재 확인, 미존재 시 `statusCode = 404` throw.

---

### 작업 4 — `POST /api/posts/:postId/comments` 댓글 작성 구현

**이 API가 하는 일**: 로그인한 사용자가 특정 게시글에 댓글을 단다. 작성 성공 시 `posts.comment_count`가 +1 된다.

**요청 형식**: `application/json`

```json
{ "content": "저도 마셔봤는데 정말 맛있었어요!" }
```

**유효성 검사**
- `content` 빈 문자열 또는 null → 400 `"댓글 내용을 입력해 주세요."`
- `content`는 `trim()` 후 저장

**트랜잭션 흐름**
1. `BEGIN`
2. 게시글 존재 확인 (미존재 시 404)
3. `INSERT INTO post_comments (post_id, user_id, content)` → `RETURNING comment_id, content, like_count, created_at`
4. `UPDATE posts SET comment_count = comment_count + 1 WHERE post_id = $1`
5. 닉네임 조회 (응답에 포함)
6. `COMMIT`

**응답 형식** (201 Created) — 명세서대로

```json
{
  "status": 201,
  "message": "댓글이 작성되었습니다.",
  "comment": {
    "comment_id": 201,
    "post_id": 101,
    "user_id": 8,
    "nickname": "전통주러버",
    "content": "저도 마셔봤는데 정말 맛있었어요!",
    "like_count": 0,
    "created_at": "2026-05-30T09:00:00"
  }
}
```

---

### 작업 5 — 라우트 등록

`src/routes/postRoutes.js`에 2개 라우트 추가. `recipeRoutes.js`가 댓글까지 한 파일에 묶는 선례를 따라 일관성 유지.

```js
// 댓글 목록 조회 — 로그인 선택
router.get('/:postId/comments', optionalAuthMiddleware, getCommentList);

// 댓글 작성 — 로그인 필수
router.post('/:postId/comments', authMiddleware, postComment);
```

---

### 작업 6 — 로컬 테스트 10종 완료 (RDS 직결)

`npm run dev`로 로컬 서버 기동 + SSM 포트 포워딩(`localhost:5433` → `judam-db` RDS)으로 운영 DB에 직접 붙여 정상·에러·권한 케이스를 모두 확인. 테스트 데이터: `post_id = 18`(작성자 `user_id = 1` 술샘양조장), 댓글 작성자는 `test-consumer@judam.com`(`user_id = 2`).

| # | 시나리오 | 기대 | 결과 |
|---|---|---|---|
| 1 | GET /posts/18/comments (비로그인, 빈 상태) | 200, `comments=[]`, `totalElements=0` | ✅ |
| 2 | POST /posts/18/comments (비로그인) | 401 | ✅ |
| 3 | POST /posts/18/comments (consumer, content="   ") | 400 `댓글 내용을 입력해 주세요.` | ✅ |
| 4 | POST /posts/9999/comments (consumer) | 404 `해당 게시글을 찾을 수 없습니다.` | ✅ |
| 5 | POST /posts/18/comments (consumer, 정상) | 201, `comment.{comment_id, post_id, user_id, nickname, content, like_count=0, created_at}` | ✅ `comment_id=1` 생성, 한글 그대로 저장 |
| 6 | GET /posts/18/comments (consumer 로그인) | 200, `is_mine=true`, `is_liked=false` | ✅ |
| 7 | GET /posts/18/comments (brewery 로그인) | 200, `is_mine=false`, `is_liked=false` | ✅ |
| 8 | GET /posts/18/comments (비로그인) | 200, `is_mine=false`, `is_liked=false` | ✅ |
| 9 | GET /posts/9999/comments | 404 | ✅ |
| 10 | GET /posts/18 (`comment_count` 확인) | `comment_count = 1` (트랜잭션 +1 반영) | ✅ |

**한글 인코딩**: PowerShell `Invoke-WebRequest`로 `Content-Type: application/json; charset=utf-8` + UTF-8 바이트 직접 전송하면 정상 저장됨. 12주차 multipart curl과 다른 경로라 5/22 발견된 CP949 손상 이슈는 발생하지 않았다.

**`comment_id = 1`**: `post_comments` 테이블 시퀀스가 처음으로 발급된 댓글. 12주차 이전까지 게시글 댓글 테이블에 row가 한 번도 없었던 것으로 확인됨. 이 row는 5/30 PUT/DELETE 테스트에 그대로 사용한다(테스트 데이터 재활용).

---

### 추가/수정한 파일 4개

| 파일 | 변경 내용 |
|---|---|
| `database/20260529_add_post_comments_parent_comment_id.sql` | 신규 — `like_count`/`updated_at`/`parent_comment_id` + FK 보강 마이그레이션 |
| `database/schema.sql` | `post_comments`에 `parent_comment_id BIGINT NULL` 컬럼 + `fk_post_comments_parent` FK 추가 (마이그레이션과 일관성) |
| `src/services/postCommentService.js` | 신규 — `getCommentsByPostId`, `createComment` 두 함수. `assertPostExists` 내부 헬퍼로 404 처리 |
| `src/controllers/postCommentController.js` | 신규 — `getCommentList`, `postComment` 두 핸들러. 400/401/404/500 분기 |
| `src/routes/postRoutes.js` | `GET /:postId/comments`, `POST /:postId/comments` 2개 라우트 추가 |

---

### 세부사항

**왜 컨트롤러에서 미리 게시글 존재 확인을 하지 않고 서비스가 throw하는 패턴을 택했나**: `postService`가 이미 `statusCode` 프로퍼티가 붙은 Error를 throw하는 패턴(`getPostById`, `updatePost`, `deletePost`)을 따르고 있어 일관성을 맞췄다. 서비스 내부에서 `SELECT 1 FROM posts WHERE post_id = $1`만 단건 조회하므로 `getPostById`의 풀 JOIN을 호출할 필요도 없다.

**대댓글 컬럼 사전 추가의 영향**: `parent_comment_id`는 14주차 대댓글 작성 API에서 본격 사용되며, 13주차 GET 쿼리에서는 `IS NULL` 필터링과 `reply_count` 서브쿼리(항상 0)에만 쓰인다. 기존 데이터의 모든 댓글은 `parent_comment_id = NULL`로 채워져 루트 댓글로 분류되므로 기존 데이터 호환성 영향 없음.

**RDS 마이그레이션 실제 적용 범위**: 작성된 ALTER 스크립트는 `like_count`/`updated_at`/`parent_comment_id` 3개 컬럼을 모두 `IF NOT EXISTS`로 추가하도록 했지만, 실제 RDS의 `post_comments`에는 `like_count`와 `updated_at`이 이미 존재했고(`schema.sql`과 동기화된 상태), **실제로 새로 추가된 것은 `parent_comment_id` 컬럼과 `fk_post_comments_parent` 자기참조 FK 1쌍**. DBeaver 실행 로그에도 `column "like_count" of relation "post_comments" already exists, skipping`, `column "updated_at" ... skipping`이 출력됐다.
