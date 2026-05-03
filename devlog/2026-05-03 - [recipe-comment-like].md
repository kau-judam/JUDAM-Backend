# 일일 보고서

* 날짜 : 5월 3일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : feature/recipe-comment-like

---

### 작업 1 — `feature/recipe-comment-like` 브랜치 생성 및 `RECIPE_COMMENT_LIKES` 테이블 구조 파악

**이 작업이 왜 필요한가**: 레시피 댓글에 좋아요 기능을 추가하려면, 누가 어떤 댓글에 좋아요를 눌렀는지를 저장하는 별도 테이블이 필요하다. 한 사람이 같은 댓글에 중복으로 좋아요를 누를 수 없어야 하므로, 테이블에 UNIQUE 제약이 걸린다.

**RECIPE_COMMENT_LIKES 테이블 구조**

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `like_id` | BIGSERIAL (PK) | 좋아요 고유 ID |
| `comment_id` | BIGINT (FK → RECIPE_COMMENTS) | 어떤 댓글의 좋아요인지 |
| `user_id` | BIGINT (FK → USERS) | 누가 누른 좋아요인지 |
| `created_at` | TIMESTAMP | 좋아요 등록 시각 |

**UNIQUE 제약**: `(comment_id, user_id)` 조합이 유일해야 한다. 즉, 동일 사용자가 같은 댓글에 좋아요를 두 번 누를 수 없다.

> 현재 DB가 연결되지 않아 `recipeCommentService.js` 안의 `MOCK_COMMENT_LIKES` 배열로 대신한다. DB 연결 후 실제 테이블로 교체 예정.

---

### 작업 2 — `POST /api/recipes/:recipeId/comments/:commentId/likes` 구현 (좋아요 등록)

**이 API가 하는 일**: 로그인한 사용자가 특정 댓글에 좋아요를 누른다. 성공하면 해당 댓글의 `like_count`가 1 증가한다.

**처리 흐름**

1. 레시피가 존재하는지 확인 → 없으면 404
2. 댓글이 존재하는지 확인 → 없으면 404
3. 이미 좋아요를 눌렀는지 확인 (UNIQUE 제약 모사) → 중복이면 409
4. `MOCK_COMMENT_LIKES`에 추가하고 댓글의 `like_count +1`
5. 200과 함께 갱신된 `like_count` 반환

**응답 예시**
```json
{ "status": 200, "message": "좋아요가 등록되었습니다.", "like_count": 6 }
```

**중복 좋아요 시도 시**
```json
{ "status": 409, "message": "이미 좋아요를 누른 댓글입니다." }
```

---

### 작업 3 — `DELETE /api/recipes/:recipeId/comments/:commentId/likes` 구현 (좋아요 취소)

**이 API가 하는 일**: 로그인한 사용자가 본인이 누른 좋아요를 취소한다. 성공하면 해당 댓글의 `like_count`가 1 감소한다 (최솟값 0 보장).

**처리 흐름**

1. 레시피가 존재하는지 확인 → 없으면 404
2. 댓글이 존재하는지 확인 → 없으면 404
3. 해당 사용자가 실제로 좋아요를 눌렀는지 확인 → 없으면 404
4. `MOCK_COMMENT_LIKES`에서 제거하고 댓글의 `like_count -1`
5. 200과 함께 갱신된 `like_count` 반환

**응답 예시**
```json
{ "status": 200, "message": "좋아요가 취소되었습니다.", "like_count": 5 }
```

**좋아요를 누르지 않은 댓글 취소 시도 시**
```json
{ "status": 404, "message": "좋아요를 누르지 않은 댓글입니다." }
```

---

### 작업 4 — 댓글 목록 조회 `is_liked` 연동 확인

기존 `GET /api/recipes/:recipeId/comments`는 이미 `MOCK_COMMENT_LIKES`를 참조해 `is_liked`를 계산하고 있었다. 오늘 구현한 좋아요 등록/취소가 동일한 `MOCK_COMMENT_LIKES` 배열을 사용하므로, 별도 코드 수정 없이도 목록 조회 시 `is_liked`가 정확히 반영된다.

**확인 결과**

| 테스트 케이스 | 결과 |
|---|---|
| 좋아요 등록 후 댓글 목록 조회 → `is_liked: true`, `like_count` 증가 | ✅ |
| 중복 좋아요 시도 | ✅ 409 반환 |
| 좋아요 취소 후 댓글 목록 조회 → `like_count` 원복 | ✅ |
| 좋아요 미등록 댓글 취소 시도 | ✅ 404 반환 |

---

### 세부사항

- **임시방편 처리**: `RECIPE_COMMENT_LIKES` 테이블이 실제 DB에 없어 `recipeCommentService.js` 내 `MOCK_COMMENT_LIKES` 인메모리 배열로 대체하여 구현했다. 서버를 재시작하면 좋아요 데이터가 초기화된다.
    - 나중에 AWS RDS가 연결되면 `likeComment` / `unlikeComment` 함수 내부의 배열 조작 로직을 실제 `RECIPE_COMMENT_LIKES` 테이블 INSERT / DELETE 쿼리로 교체해야 한다.
    - `like_count` 증감도 현재는 인메모리 배열의 값을 직접 수정하지만, DB 연결 후에는 `RECIPE_COMMENTS.like_count`를 UPDATE하는 쿼리로 교체해야 한다.
