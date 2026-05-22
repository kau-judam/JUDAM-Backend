# 일일 보고서

* 날짜 : 5월 30일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : feature/post-comment-crud (5/29에서 이어서)

---

### 작업 0 — 브랜치 유지 + 작업 범위

13주차 두 번째 작업일. 같은 리소스(`/posts/{postId}/comments/{commentId}`)에 대한 PUT/DELETE 두 메서드라 5/29의 `feature/post-comment-crud` 브랜치를 그대로 이어 사용. 13주차 DailyToDo대로 PUT은 우선순위 13-03, DELETE는 13-04.

---

### 작업 1 — 명세서 vs DailyToDo 충돌점 검토

13주차 PUT/DELETE 명세서에 대해 DailyToDo와 충돌하는 항목은 없다. 다만 명세서에서 명시되지 않은 두 가지 구현 결정이 필요했고, 모두 12주차/5/29 선례 패턴을 따랐다.

| 항목 | 명세서 | 결정 |
|---|---|---|
| `postId`/`commentId` mismatch (다른 게시글의 댓글 ID로 호출) | 응답 미정의 | **postId + commentId 둘 다 일치해야 식별** (`WHERE comment_id = $1 AND post_id = $2`). post가 없거나 댓글이 그 post에 속하지 않으면 404 `해당 댓글을 찾을 수 없습니다.` |
| 트랜잭션 범위 | 명시 없음 | PUT: 단일 UPDATE라 `pool.query` 직접 사용. DELETE: post_comments DELETE + posts.comment_count -1 두 쿼리라 트랜잭션 |
| `comment_count` 음수 방지 | "0 미만으로 내려가지 않도록 보호" | `GREATEST(comment_count - 1, 0)`로 처리 |
| `POST_COMMENT_LIKES` 정리 | "cascade 또는 명시적 삭제" | FK `ON DELETE CASCADE`로 자동 (5/29 RDS 직접 확인) — 별도 DELETE 쿼리 불필요 |

---

### 작업 2 — `PUT /api/posts/:postId/comments/:commentId` 댓글 수정 구현

**이 API가 하는 일**: 로그인한 사용자가 자신의 게시글 댓글 내용을 수정한다. 작성자 본인만 가능, 수정 성공 시 `updated_at`이 현재 시각으로 갱신된다.

**유효성 / 권한 검증 순서** (서비스 내부)
1. `SELECT user_id FROM post_comments WHERE comment_id = $1` → 미존재 시 404
2. `Number(user_id) !== Number(JWT.user_id)` → 403
3. `UPDATE post_comments SET content, updated_at = CURRENT_TIMESTAMP ... RETURNING ...`

**컨트롤러 선검증**
- `commentId`가 정수·양수 아니면 즉시 404
- `content`가 비어있거나 trim 결과 빈 문자열이면 400

**응답 형식** — 명세서대로 축약 (`{ comment_id, content, updated_at }` 3개 필드만)

```json
{
  "status": 200,
  "message": "댓글이 수정되었습니다.",
  "comment": {
    "comment_id": 1,
    "content": "수정된 내용 — 5/30 테스트",
    "updated_at": "2026-05-22T00:09:40.182Z"
  }
}
```

---

### 작업 3 — `DELETE /api/posts/:postId/comments/:commentId` 댓글 삭제 구현

**이 API가 하는 일**: 로그인한 사용자가 자신의 게시글 댓글을 삭제한다. 작성자 본인만 가능, 삭제 성공 시 `posts.comment_count`가 -1 된다.

**트랜잭션 흐름**
1. `BEGIN`
2. `SELECT user_id, post_id FROM post_comments WHERE comment_id = $1` → 미존재 시 404
3. `Number(user_id) !== Number(JWT.user_id)` → 403
4. `DELETE FROM post_comments WHERE comment_id = $1`
5. `UPDATE posts SET comment_count = GREATEST(comment_count - 1, 0) WHERE post_id = $1`
6. `COMMIT`

**연관 데이터 자동 정리**: `post_comment_likes` 테이블이 `FOREIGN KEY (comment_id) REFERENCES post_comments(comment_id) ON DELETE CASCADE`로 묶여 있어 댓글 삭제 시 좋아요 레코드도 자동 제거. 마이그레이션에서 추가한 `parent_comment_id` 자기참조 FK 역시 `ON DELETE CASCADE`라 대댓글이 달려 있어도 부모 댓글 삭제 시 함께 제거된다(14주차 대댓글 기능 활성화 후에도 동작 보장).

**응답 형식** — 명세서대로

```json
{ "status": 200, "message": "댓글이 삭제되었습니다." }
```

---

### 작업 4 — 라우트 등록

`src/routes/postRoutes.js`에 5/29의 GET/POST 아래로 2개 라우트 추가.

```js
// 댓글 수정 — 로그인 필수, 작성자 본인만
router.put('/:postId/comments/:commentId', authMiddleware, putCommentHandler);

// 댓글 삭제 — 로그인 필수, 작성자 본인만
router.delete('/:postId/comments/:commentId', authMiddleware, deleteCommentHandler);
```

---

### 작업 5 — 로컬 테스트 15종 완료 (RDS 직결)

5/29 SSM 터널을 그대로 유지한 상태로 `npm run dev` nodemon 자동 재기동 후 PowerShell `Invoke-WebRequest`로 직접 호출. 권한 케이스용으로 brewery 토큰(`user_id=3`)으로 새 댓글(`comment_id=5`)을 만들어 consumer 토큰이 수정·삭제 시도 → 403 동작을 검증했다.

#### PUT 6종

| # | 시나리오 | 기대 | 결과 |
|---|---|---|---|
| P1 | PUT 비로그인 | 401 | ✅ |
| P2 | PUT (consumer, content="   ") | 400 `댓글 내용을 입력해 주세요.` | ✅ |
| P3 | PUT commentId=9999 (없음) | 404 `해당 댓글을 찾을 수 없습니다.` | ✅ |
| P4 | PUT (consumer, brewery 댓글 5) | 403 `본인이 작성한 댓글만 수정할 수 있습니다.` | ✅ |
| P5 | PUT (consumer, 본인 comment_id=1) | 200, `comment.{comment_id, content, updated_at}` | ✅ updated_at 새로 채워짐 |
| P6 | GET /comments — 수정 반영 확인 | comment_id=1의 `content` 변경, `updated_at != null` | ✅ |

#### DELETE 5종

| # | 시나리오 | 기대 | 결과 |
|---|---|---|---|
| D1 | DELETE 비로그인 | 401 | ✅ |
| D2 | DELETE commentId=9999 | 404 | ✅ |
| D3 | DELETE (consumer, brewery 댓글 5) | 403 `본인이 작성한 댓글만 삭제할 수 있습니다.` | ✅ |
| D4 | DELETE (brewery, 본인 댓글 5) | 200 `댓글이 삭제되었습니다.` | ✅ |
| D5 | GET /api/posts/18 — `comment_count` | 삭제 전 5 → 삭제 후 4 (트랜잭션 -1 반영) | ✅ |

#### postId/commentId mismatch 회귀 4종 (사용자 직접 검증 중 발견된 버그 → 수정 후 재검증)

초기 구현에서는 서비스 쿼리가 `WHERE comment_id = $1`만 사용해 postId path param이 무시됐고, `PUT /api/posts/9999/comments/2`(post 9999 미존재)도 200을 반환하는 일관성 버그가 있었다. 5/29 GET/POST가 `assertPostExists`로 post를 검증하던 것과 어긋난 점이 원인. 쿼리에 `AND post_id = $2`를 추가해 mismatch도 404로 처리하도록 수정한 뒤 다음 4종을 추가 확인했다.

| # | 시나리오 | 기대 | 결과 |
|---|---|---|---|
| M1 | PUT /posts/**9999**/comments/2 (post 자체 없음) | 404 `해당 댓글을 찾을 수 없습니다.` | ✅ |
| M2 | PUT /posts/**17**/comments/2 (댓글은 post=18 소속) | 404 | ✅ |
| M3 | DELETE /posts/**9999**/comments/4 | 404 | ✅ |
| M4 | DELETE /posts/**17**/comments/4 (mismatch) | 404 | ✅ |

수정 후 정상 경로(`PUT /posts/18/comments/2`)도 200 그대로 동작함을 회귀 확인. service 함수 시그니처가 `update/deleteComment(postId, commentId, ...)`로 바뀐 점, 그리고 컨트롤러에서 `postId` path param도 정수·양수 검증이 추가된 점이 차이.

**`comment_count` 증감 정합성**: 5/29(작성 → +1, count 0→1) + 5/30 검증용 작성 + brewery 작성 + DELETE → 모든 단계에서 +1/-1이 트랜잭션 안에서 정확히 반영. 음수 보호(`GREATEST(..., 0)`) 로직은 정상 케이스에서 발동되지 않지만 동시 삭제 race condition에서 안전망 역할.

---

### 추가/수정한 파일 3개

| 파일 | 변경 내용 |
|---|---|
| `src/services/postCommentService.js` | `updateComment`(권한 검증 후 단일 UPDATE), `deleteComment`(권한 검증 + DELETE + comment_count -1 트랜잭션) 두 함수 추가 |
| `src/controllers/postCommentController.js` | `putCommentHandler`, `deleteCommentHandler` 두 핸들러 추가 — 400/401/403/404/500 분기 |
| `src/routes/postRoutes.js` | `PUT /:postId/comments/:commentId`, `DELETE /:postId/comments/:commentId` 2개 라우트 추가 |

---

### 세부사항

**왜 PUT은 트랜잭션 안 쓰고 DELETE는 쓰나**: PUT은 SELECT(권한) → UPDATE(content) 두 쿼리지만 동일 row를 다루고 두 쿼리 사이에 다른 테이블 갱신이 없다. SELECT~UPDATE 사이에 race로 권한이 바뀌더라도 본인 외에는 `user_id`를 바꿀 경로가 없으니 문제 없음. DELETE는 `post_comments DELETE` + `posts.comment_count UPDATE` 두 테이블에 걸친 변경이라 트랜잭션으로 묶지 않으면 부분 실패 시 `comment_count`가 어긋날 수 있어 필수.

**postId/commentId 일관성 검증 (초기 구현 버그 → 수정)**: 처음에는 service 쿼리를 `WHERE comment_id = $1`만 사용했고 devlog 초안에도 "postId path param 무시"로 합리화해 적었으나, 사용자 직접 검증 중 `PUT /posts/9999/comments/2`가 200을 반환하는 일관성 버그가 드러났다. 5/29 GET/POST는 `assertPostExists`로 post를 검증하는데 PUT/DELETE만 그 검증을 빠뜨린 게 원인. 쿼리에 `AND post_id = $2`를 추가해 post가 없거나 댓글이 그 post 소속이 아니면 404로 처리하도록 수정. service 시그니처는 `update/deleteComment(postId, commentId, ...)`로 변경됐고, 컨트롤러에서 `postId` path param도 정수·양수 검증을 추가했다. (회귀 4종 — 작업 5 표 마지막 섹션 참고)

**테스트 후 RDS 상태**: post_id=18에 댓글 4개(`comment_id` 1~4, 모두 consumer 작성) 남음. `comment_id=1`은 PUT 테스트로 content/updated_at가 수정된 상태. `comment_id=5`(brewery)는 DELETE로 사라졌고 `post_comment_likes` 관련 데이터도 cascade로 함께 제거됨. `posts.comment_count = 4`로 정합.
