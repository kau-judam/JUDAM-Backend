# 일일 보고서

* 날짜 : 6월 6일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : feature/post-comment-like (6/5에서 이어서)

---

### 작업 0 — 작업 범위

14주차 토요일. DailyToDo 토요일 계획은 **게시글 댓글 좋아요 API 2종 구현** + UNIQUE 중복 처리 + 브랜치 마무리. 어제(6/5)에 `feature/post-comment-like` 브랜치 생성과 `post_comment_likes` 테이블 사전 검증(RDS에 이미 ERD 스펙대로 완비)이 끝났으므로, 오늘은 코드만 작성하면 됨.

작업 시작 시점 상태:
- 브랜치 `feature/post-comment-like`, working tree에 어제 일일 보고서만 untracked
- `post_comments`의 `like_count[1, 2, 4, 9, 12] = 0` 모두 baseline
- `post_comment_likes` 테이블 0 rows (깨끗한 시작)
- 13주차 `post_likes` 구현(`postLikeService.js`/`postLikeController.js`)이 거의 동일 패턴이라 그대로 복제 후 대상 테이블·메시지만 치환

---

### 작업 1 — `postCommentLikeService.js` 신규 작성

`src/services/postCommentLikeService.js` 신규 파일에 함수 3개 추가.

#### `assertCommentExists(client, postId, commentId)` — private 헬퍼

```js
const result = await client.query(
  'SELECT 1 FROM post_comments WHERE comment_id = $1 AND post_id = $2',
  [commentId, postId]
);
if (result.rowCount === 0) throw 404 "해당 댓글을 찾을 수 없습니다."
```

**핵심 — `WHERE comment_id = $1 AND post_id = $2` 묶음 쿼리 한 번**으로 두 가지를 동시에 잡는다:
- 댓글 자체가 없는 경우(`commentId` 미존재)
- post-comment mismatch (예: `postId=10`인데 `commentId=1`은 post 18 소속) — 13주차 댓글 CRUD 5/30에서 사용자가 발견했던 회귀 버그(`PUT /posts/9999/comments/2`가 200 반환) 패턴을 처음부터 차단.

명세서가 "댓글 미존재 404"만 정의하고 post 미존재 별도 응답을 두지 않았으므로, 두 경우 모두 같은 404로 통일.

#### `likeComment(postId, commentId, userId)` 함수

13주차 `likePost`와 동일 골격, 대상 테이블만 교체:

```
BEGIN
assertCommentExists(client, postId, commentId)
try INSERT post_comment_likes (comment_id, user_id) catch 23505 → 400 "이미 좋아요한 댓글입니다."
UPDATE post_comments SET like_count = like_count + 1 WHERE comment_id = $1 RETURNING like_count
COMMIT
return { comment_id, like_count: Number(...) }
```

명세서 응답 키는 13주차의 `data: { post_id, like_count }`와 달리 **`data: { comment_id, like_count }`** 임에 주의.

#### `unlikeComment(postId, commentId, userId)` 함수

```
BEGIN
assertCommentExists(client, postId, commentId)
DELETE FROM post_comment_likes WHERE comment_id=$1 AND user_id=$2 RETURNING like_id
if rowCount === 0 → 400 "좋아요 내역이 없습니다."
UPDATE post_comments SET like_count = GREATEST(like_count - 1, 0) WHERE comment_id=$1 RETURNING like_count
COMMIT
return { comment_id, like_count: Number(...) }
```

`GREATEST(... - 1, 0)`는 동시성·드리프트 안전망(5/30 댓글 DELETE, 6/1 게시글 좋아요 취소와 동일 패턴).

---

### 작업 2 — `postCommentLikeController.js` 신규 작성

`src/controllers/postCommentLikeController.js` 신규. 핸들러 2개.

**path param 검증 — postId·commentId 모두 양수 정수만 허용**:

```js
const postId    = parseInt(req.params.postId, 10);
const commentId = parseInt(req.params.commentId, 10);
if (!Number.isInteger(postId) || postId <= 0 ||
    !Number.isInteger(commentId) || commentId <= 0) {
  return 404 "해당 댓글을 찾을 수 없습니다."
}
```

13주차 게시글 좋아요는 `postId` 1개만 검증했지만, 14주차는 path param이 2개라 둘 다 검증. 명세서가 댓글 미존재 메시지만 정의하므로 어느 쪽이 잘못되든 메시지는 통일.

성공 응답:
- POST: `200 { status:200, message:"좋아요 등록 완료", data:{ comment_id, like_count } }`
- DELETE: `200 { status:200, message:"좋아요 취소 완료", data:{ comment_id, like_count } }`

서비스에서 throw된 `statusCode` 속성을 보고 400/404 분기, 그 외는 500.

---

### 작업 3 — `postRoutes.js` 라우트 등록 (2줄)

require 블록에 추가:
```js
const {
  postCommentLike,
  deleteCommentLike,
} = require('../controllers/postCommentLikeController');
```

라우트 — **댓글 삭제 라우트(line 49) 직후, 게시글 좋아요 라우트(line 52) 직전**에 끼워넣음:
```js
// 댓글 좋아요 등록 — 로그인 필수 (UNIQUE 위반 시 400)
router.post('/:postId/comments/:commentId/likes', authMiddleware, postCommentLike);

// 댓글 좋아요 취소 — 로그인 필수 (내역 없으면 400)
router.delete('/:postId/comments/:commentId/likes', authMiddleware, deleteCommentLike);
```

라우트 매칭 충돌 없음 — `/:postId/likes`(segment 3개)와 `/:postId/comments/:commentId/likes`(segment 5개)는 path 구조가 명확히 구분됨. `/:postId/comments/:commentId`(PUT/DELETE)와도 segment 개수가 다름.

---

### 작업 4 — 통합 테스트 12종 + 회귀 점검 3종

`npm run dev` 로컬 서버 + SSM 터널 재오픈(어제 자동 종료) + `psql`로 baseline 확인 후 consumer(`user_id=2`) / brewery(`user_id=3`) 토큰 발급. 메인 대상 댓글: `(postId=18, commentId=1)`.

#### POST/DELETE 흐름 (L1~L6) — `like_count` round-trip 정합

| # | 시나리오 | 기대 | 결과 | `like_count` |
|---|---|---|---|---|
| L1 | POST 18/1 (consumer) | 200, "좋아요 등록 완료" | ✅ | 0→1 |
| L2 | POST 18/1 (consumer 중복) | 400, "이미 좋아요한 댓글입니다." | ✅ (ROLLBACK 무변화) | 1→1 |
| L3 | POST 18/1 (brewery) | 200, "좋아요 등록 완료" | ✅ | 1→2 |
| L4 | DELETE 18/1 (consumer) | 200, "좋아요 취소 완료" | ✅ | 2→1 |
| L5 | DELETE 18/1 (consumer 중복) | 400, "좋아요 내역이 없습니다." | ✅ (ROLLBACK 무변화) | 1→1 |
| L6 | DELETE 18/1 (brewery) | 200, "좋아요 취소 완료" | ✅ | 1→0 (baseline 복귀) |

#### 404 / 인증 / path param (L7~L12)

| # | 시나리오 | 기대 | 결과 |
|---|---|---|---|
| L7 | POST 18/99999 (댓글 미존재) | 404, "해당 댓글을 찾을 수 없습니다." | ✅ |
| L8 | POST 10/1 (mismatch — comment 1은 post 18 소속) | 404, "해당 댓글을 찾을 수 없습니다." | ✅ |
| L9 | POST 18/1 (Authorization 헤더 없음) | 401, "유효하지 않거나 만료된 토큰입니다." | ✅ |
| L10 | POST abc/1 (비정수 postId) | 404, "해당 댓글을 찾을 수 없습니다." | ✅ |
| L11 | POST 18/0 (0 commentId) | 404, "해당 댓글을 찾을 수 없습니다." | ✅ |
| L12 | DELETE 18/99999 (DELETE 댓글 미존재) | 404, "해당 댓글을 찾을 수 없습니다." | ✅ |

#### DB 부수 효과 검증 (L6 종료 후 SSM psql 직접 조회)

| 항목 | 기대 | 실제 |
|---|---|---|
| `post_comments.like_count[1]` | 0 (baseline) | ✅ 0 |
| `post_comments.like_count[2, 4, 9, 12]` | 0 (다른 댓글 영향 없음) | ✅ 모두 0 |
| `post_comment_likes` 총 row 수 | 0 (모두 정리) | ✅ 0 |

#### 13주차 회귀 점검 (R1~R3)

| # | 시나리오 | 기대 | 결과 |
|---|---|---|---|
| R1 | GET `/api/posts/18/comments` (13주차 댓글 목록) | 200, comment 5개 반환 | ✅ |
| R2 | POST `/api/posts/18/likes` (13주차 게시글 좋아요) | 200, `like_count=1` | ✅ |
| R3 | DELETE `/api/posts/18/likes` (13주차 게시글 좋아요 취소) | 200, `like_count=0` | ✅ |

14주차 신규 라우트 등록이 기존 라우트에 영향 주지 않음을 확인.

---

### 추가/수정한 파일

| 파일 | 변경 |
|---|---|
| `src/services/postCommentLikeService.js` | **신규** — `assertCommentExists`, `likeComment`, `unlikeComment` 3종 |
| `src/controllers/postCommentLikeController.js` | **신규** — `postCommentLike`, `deleteCommentLike` 2종 |
| `src/routes/postRoutes.js` | require 블록 + 라우트 2줄 추가 (댓글 CRUD와 게시글 좋아요 사이에 배치) |

코드 수정은 라우트 파일 1곳만, 나머지는 신규 작성. 13주차 `postLikeService`/`postLikeController`의 패턴을 그대로 따랐기 때문에 학습 비용·리뷰 비용 최소화.

---

### 세부사항

**왜 `post_comments.like_count` 직접 갱신인가**: 댓글 행 자체가 `like_count` 컬럼을 갖고 있다(13주차 댓글 CRUD 마이그레이션에서 추가됨). 매번 `COUNT(*)` 집계 대신 캐시 컬럼을 유지하는 패턴은 13주차 `posts.like_count`와 동일. 동시성은 PostgreSQL row lock으로 `UPDATE ... like_count + 1`이 직렬화되므로 별도 잠금 불필요.

**`posts.comment_count`는 건드리지 않음**: 명세서 확인 결과 좋아요는 댓글 자체에만 영향을 줌. 댓글 개수가 늘어나거나 줄어드는 게 아니므로 게시글의 `comment_count`는 미변경.

**brewery 토큰도 좋아요 가능**: 명세서가 "JWT 인증된 사용자"만 요구하고 user/brewery 역할 구분을 두지 않음. 13주차 `post_likes`와 동일 정책. 테스트 L3에서 brewery 토큰으로도 정상 등록 확인.

**메시지 복붙 누락 방지 확인**: 작성 후 `grep "게시글" postCommentLike*.js`로 점검. 컨트롤러 매칭 0건, 서비스는 주석의 "게시글 댓글 좋아요" 컨텍스트(메시지 아님) 2건만 잡힘. 메시지 본문에서 "댓글" 누락 없음.

**브랜치 작업 마무리**: 14주차 토요일 계획 4개 모두 완료. develop PR 준비 가능 상태.
