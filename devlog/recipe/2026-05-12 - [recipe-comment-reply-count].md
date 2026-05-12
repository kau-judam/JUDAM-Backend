# 일일 보고서

* 날짜 : 5월 12일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : feature/recipe-comment-reply-count

---

### 배경

프론트엔드팀에서 댓글 목록 조회 시 각 댓글에 대댓글이 몇 개 있는지 미리 알 수 없어, "N개 답글" 버튼을 표시하려면 무조건 대댓글 목록 API를 먼저 호출해야 하는 문제를 제기했다. 이를 해결하기 위해 두 API의 응답 스펙을 수정했다.

---

### 작업 1 — `GET /api/recipes/{recipeId}/comments` 댓글 목록 — `reply_count` 필드 추가

**변경 내용**: 각 댓글 객체에 `reply_count` 필드를 추가했다.

**구현 방식**: DB 쿼리의 SELECT 절에 아래 서브쿼리를 추가했다.

```sql
(SELECT COUNT(*)::INT FROM recipe_comments WHERE parent_comment_id = rc.comment_id) AS reply_count
```

`recipe_comments` 테이블에서 `parent_comment_id`가 해당 댓글 ID와 일치하는 행의 수를 세는 방식이다. 대댓글이 없으면 `0`을 반환한다.

**응답 예시 (변경 후)**

```json
{
  "comment_id": 10,
  "content": "복숭아 막걸리 정말 기대됩니다!",
  "like_count": 3,
  "reply_count": 2,
  "is_liked": false,
  "is_mine": false
}
```

---

### 작업 2 — `POST /api/recipes/{recipeId}/comments/{commentId}/replies` 대댓글 작성 — `parent_reply_count` 필드 추가

**변경 내용**: 대댓글 작성 후 응답에 `parent_reply_count`를 추가했다.

**`parent_reply_count`가 뭔지**: 방금 작성한 대댓글이 달린 **부모 댓글의 현재 대댓글 총 개수**다. 예를 들어 부모 댓글에 대댓글이 1개 있는 상태에서 새로 작성하면 `parent_reply_count: 2`가 된다.

**왜 필요한가**: 대댓글 작성 직후 화면의 "N개 답글" 버튼 숫자를 갱신하기 위해서다. 이 값이 없으면 프론트에서 댓글 목록 API를 다시 호출해야 한다.

**구현 방식**: INSERT 완료 후 아래 쿼리로 최신 대댓글 수를 조회해 반환한다.

```sql
SELECT COUNT(*)::INT AS reply_count FROM recipe_comments WHERE parent_comment_id = $1
```

**응답 예시 (변경 후)**

```json
{
  "status": 201,
  "message": "대댓글이 등록되었습니다.",
  "reply": {
    "comment_id": 25,
    "parent_comment_id": 10,
    "content": "저도 그렇게 생각해요!",
    "like_count": 0,
    "created_at": "2026-05-12T...",
    "parent_reply_count": 2
  },
  "parent_reply_count": 2
}
```

`reply` 객체 안과 응답 최상위 모두에 동일값을 포함시켰다. 프론트에서 어느 위치에서 읽든 동일하게 처리할 수 있도록 하기 위해서다.

---

### 작업 3 — 로컬 테스트 완료

| 테스트 | 결과 |
|---|---|
| `GET /api/recipes/{recipeId}/comments` — 대댓글 있는 댓글의 reply_count | 정상값 반환 |
| `GET /api/recipes/{recipeId}/comments` — 대댓글 없는 댓글의 reply_count | 0 반환 |
| `POST /api/recipes/{recipeId}/comments/{commentId}/replies` — parent_reply_count | 작성 후 최신 카운트 반환 |

---

### 수정 파일 목록

| 파일 | 변경 내용 |
|---|---|
| `src/services/recipeCommentService.js` | 댓글 목록 SELECT에 reply_count 서브쿼리 추가, 대댓글 작성 후 parent_reply_count 조회 및 반환 |
| `src/controllers/recipeCommentController.js` | 대댓글 작성 응답 바디에 parent_reply_count 추가 |
| `00.DefaultContext/API 문서/9주차/레시피 댓글 목록 조회.md` | reply_count 필드 스펙 추가 |
| `00.DefaultContext/API 문서/9주차/레시피 댓글 대댓글 작성.md` | parent_reply_count 필드 스펙 추가 |
