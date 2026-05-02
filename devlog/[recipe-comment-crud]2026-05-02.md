# 일일 보고서

* 날짜 : 5월 2일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : feature/recipe-comment-crud

---

### 작업 1 — `PUT /api/recipes/:recipeId/comments/:commentId` 댓글 수정 구현

**이 API가 하는 일**: 특정 레시피의 댓글 내용을 수정한다. 단, 댓글을 직접 작성한 본인만 수정할 수 있다.

**요청 형식**

| 항목 | 내용 |
|---|---|
| 메서드 | PUT |
| 경로 | `/api/recipes/:recipeId/comments/:commentId` |
| 인증 | Bearer 토큰 필수 (로그인한 사용자만 가능) |
| 요청 바디 | `{ "content": "수정할 내용" }` |

**처리 흐름 — 3단계 검증 후 수정**

1. `recipeId`로 레시피 존재 여부 확인 → 없으면 404 반환
2. `commentId`로 댓글 존재 여부 확인 → 없으면 404 반환
3. 댓글의 `user_id`와 JWT에서 추출한 요청자 `id` 비교 → 다르면 403 반환
4. 3가지 모두 통과하면 `content` 수정 + `updated_at` 현재 시각으로 갱신

**응답 예시 (성공)**

```json
{
  "status": 200,
  "message": "댓글이 수정되었습니다.",
  "comment": {
    "comment_id": 1,
    "user_nickname": "막걸리덕후",
    "content": "수정된 댓글 내용입니다.",
    "like_count": 5,
    "created_at": "2026-04-30T10:00:00.000Z",
    "updated_at": "2026-05-02T14:00:00.000Z"
  }
}
```

**오류 응답**

| 상황 | HTTP 상태 | 메시지 |
|---|---|---|
| content가 빈 문자열 | 400 | 댓글 내용을 입력해 주세요. |
| recipeId에 해당하는 레시피 없음 | 404 | 해당 레시피를 찾을 수 없습니다. |
| commentId에 해당하는 댓글 없음 | 404 | 해당 댓글을 찾을 수 없습니다. |
| 작성자가 아닌 사람이 수정 시도 | 403 | 본인이 작성한 댓글만 수정할 수 있습니다. |

---

### 작업 2 — `DELETE /api/recipes/:recipeId/comments/:commentId` 댓글 삭제 구현

**이 API가 하는 일**: 특정 레시피의 댓글을 삭제한다. 댓글을 직접 작성한 본인만 삭제할 수 있다.

**요청 형식**

| 항목 | 내용 |
|---|---|
| 메서드 | DELETE |
| 경로 | `/api/recipes/:recipeId/comments/:commentId` |
| 인증 | Bearer 토큰 필수 |
| 요청 바디 | 없음 |

**처리 흐름** — 수정과 동일한 3단계 검증 후 삭제

**응답 예시 (성공)**

```json
{
  "status": 200,
  "message": "댓글이 삭제되었습니다."
}
```

**오류 응답** — 수정 API와 동일한 404/403 패턴

---

### 작업 3 — 권한 검증 구조 설명

댓글 수정·삭제 모두 동일한 방식으로 작성자 검증을 한다. 로그인 시 발급되는 JWT 토큰 안에는 사용자의 `id`가 들어있고, `authMiddleware`가 이 토큰을 검증한 후 `req.user.id`로 꺼내준다. 댓글 테이블의 `user_id`(댓글 작성자)와 이 값을 비교해서 다르면 403 오류를 내보낸다.

```
요청자 (JWT) → req.user.id
댓글 작성자  → comment.user_id
→ 두 값이 다르면 403 반환
→ 같으면 수정/삭제 진행
```

---

### 작업 4 — `feature/recipe-comment-crud` 브랜치 마무리

오늘 작업으로 이 브랜치에서 해야 할 4개의 API(목록 조회·작성·수정·삭제)가 모두 완료되었다.

| API | 구현일 | 상태 |
|---|---|---|
| `GET /recipes/:recipeId/comments` | 5월 1일 | 완료 |
| `POST /recipes/:recipeId/comments` | 5월 1일 | 완료 |
| `PUT /recipes/:recipeId/comments/:commentId` | 5월 2일 | 완료 |
| `DELETE /recipes/:recipeId/comments/:commentId` | 5월 2일 | 완료 |

---

### 세부사항 (임시방편 처리 내역)

#### 현재 목 데이터(MOCK_COMMENTS) 사용 중

지금은 실제 DB가 연결되지 않아 `recipeCommentService.js` 내부에 `MOCK_COMMENTS` 배열을 직접 하드코딩해 두고 있다. 서버를 재시작하면 댓글 데이터가 초기화된다.

**나중에 DB 연결 시 교체해야 할 코드 위치**

| 함수 | 교체 내용 |
|---|---|
| `getCommentsByRecipeId` | `RECIPE_COMMENTS JOIN USERS + RECIPE_COMMENT_LIKES LEFT JOIN` SELECT 쿼리 |
| `createComment` | `RECIPE_COMMENTS` INSERT 쿼리 |
| `getCommentById` | `RECIPE_COMMENTS` WHERE comment_id SELECT 쿼리 |
| `updateComment` | `RECIPE_COMMENTS` UPDATE 쿼리 |
| `deleteComment` | `RECIPE_COMMENTS` DELETE 쿼리 |

또한 닉네임 반환도 현재 `MOCK_USER_NICKNAMES` 고정 매핑을 쓰고 있으므로, DB 연결 후에는 `USERS` 테이블에서 닉네임을 조회하도록 교체해야 한다.
