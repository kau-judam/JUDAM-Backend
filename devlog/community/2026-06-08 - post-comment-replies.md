# 일일 보고서

* 날짜 : 6월 8일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : feature/post-comment-replies

---

### 작업 1 — WBS 외 미확정이던 대댓글 명세 2종을 14주차로 편입 결정

`API_주차별_계획.md` 14주차 마지막에는 "**[WBS 외 — 대댓글 명세 (구현 일정 미확정)]**" 분류로 대댓글 작성/조회 2개가 명세서만 작성된 상태로 있었다. 명세서는 14주차 폴더에 있지만 DailyToDo의 14주차 일정에는 작업 항목이 없는 어정쩡한 상태.

오늘 점검한 결과:

- **DB 마이그레이션은 이미 적용됨** — `database/20260529_add_post_comments_parent_comment_id.sql`로 5/29에 `parent_comment_id` 컬럼 + 자기참조 FK가 운영 RDS에 반영 완료
- **명세서 완비됨** — 작성/조회 두 명세서 모두 14주차 폴더에 작성되어 있음
- 즉, 구현만 하면 끝나는 상태였음

→ DailyToDo 14주차 월요일 섹션에 "[WBS 외] 대댓글 작성/조회 — 14주차 편입" 블록을 추가하고 오늘 작업으로 진행. 15주차 통합 테스트 일정에는 별도 영향 없음.

---

### 작업 2 — `POST /api/posts/{postId}/comments/{commentId}/replies` 대댓글 작성 구현

**이 API가 하는 일**: 로그인한 사용자가 특정 댓글에 대한 대댓글을 작성한다. `parent_comment_id`가 설정된 댓글을 새로 생성하며 깊이 제한은 없다(부모가 루트 댓글이든 대댓글이든 작성 가능, UI 표현은 프론트 담당).

**핵심 검증 로직**

- 부모 댓글이 **(postId, commentId) 쌍**으로 존재하는지 검증 — `WHERE comment_id = $1 AND post_id = $2`. 없으면 404 `부모 댓글을 찾을 수 없습니다.`
- 본문 검증 — `content` 비어있거나 공백만 있으면 400 `대댓글 내용을 입력해 주세요.`
- INSERT 후 `SELECT COUNT(*) FROM post_comments WHERE parent_comment_id = $1`로 부모 댓글의 최신 대댓글 수를 조회해 `parent_reply_count`로 반환 — 작성 직후 "N개 답글" 버튼 숫자를 별도 API 호출 없이 즉시 갱신하기 위해

**응답 구조** — 명세서대로 `parent_reply_count`를 `reply` 객체 내부 + 최상위 양쪽 모두에 동봉

```json
{
  "status": 201,
  "message": "대댓글이 등록되었습니다.",
  "reply": {
    "comment_id": 14,
    "post_id": 24,
    "parent_comment_id": 13,
    "user_id": 2,
    "nickname": "테스트소비자",
    "content": "reply by consumer",
    "created_at": "...",
    "parent_reply_count": 1
  },
  "parent_reply_count": 1
}
```

**`posts.comment_count`는 갱신하지 않음** — 레시피 대댓글 작성 API(`recipeCommentService.createReply`)의 패턴을 채택. 결과적으로 게시글의 `comment_count`는 "루트 댓글 수" 의미가 유지된다.

---

### 작업 3 — `GET /api/posts/{postId}/comments/{commentId}/replies` 대댓글 목록 조회 구현

**이 API가 하는 일**: 특정 댓글에 달린 대댓글 목록을 페이지네이션으로 반환한다. **비로그인 사용자도 접근 가능** (`optionalAuthMiddleware`). 로그인 시 각 대댓글에 대한 좋아요 여부(`is_liked`)와 본인 작성 여부(`is_mine`)를 함께 반환한다.

**쿼리 구조**

- `WHERE pc.parent_comment_id = $1 ORDER BY pc.created_at ASC` — 부모 댓글의 직속 자식만, 오래된 대댓글 먼저
- `LEFT JOIN post_comment_likes pcl ON pcl.comment_id = pc.comment_id AND pcl.user_id = $4` — 로그인 사용자 기준 `is_liked` 판정
- `CASE WHEN pc.user_id = $4 THEN true ELSE false END AS is_mine` — 추가 쿼리 없이 SELECT 표현식으로 본인 작성 여부 판정
- 별도 COUNT 쿼리로 `totalElements` + `totalPages` 계산
- **부모 댓글이 없어도 빈 배열 반환** (에러 X) — 명세서 line 129 준수

**응답 구조**

```json
{
  "replies": [
    {
      "comment_id": 14,
      "user_id": 2,
      "nickname": "테스트소비자",
      "author_profile_image": null,
      "content": "reply by consumer",
      "is_liked": false,
      "is_mine": true,
      "created_at": "...",
      "updated_at": null
    }
  ],
  "totalElements": 2,
  "totalPages": 1,
  "currentPage": 0
}
```

**쿼리 파라미터**: `page`(0부터, 기본 0) / `size`(기본 20)

---

### 작업 4 — 라우트 등록

신규 코드는 모두 기존 파일 안에 추가하는 형태(신규 파일 없음):

| 위치 | 추가 내용 |
|---|---|
| `src/services/postCommentService.js` | `getRepliesByCommentId`, `createReply` 함수 2개 |
| `src/controllers/postCommentController.js` | `getReplyList`, `postReply` 핸들러 2개 |
| `src/routes/postRoutes.js` | 라우트 2줄 |

라우트:

```javascript
router.get('/:postId/comments/:commentId/replies', optionalAuthMiddleware, getReplyList);
router.post('/:postId/comments/:commentId/replies', authMiddleware, postReply);
```

라우트 segment가 기존 `/:postId/comments/:commentId/likes`나 `/:postId/comments/:commentId`와 다르므로 매칭 충돌 없음.

---

### 작업 5 — 명세서 일관성 수정 (`is_liked` 누락)

대댓글 목록 조회 명세서(`14주차/게시글 댓글 대댓글 목록 조회.md`)에서 내부 불일치를 발견:

| 위치 | 내용 |
|---|---|
| 본문 line 16 | "로그인한 사용자의 경우 각 대댓글에 대한 좋아요 여부(`is_liked`)와 본인 작성 여부(`is_mine`)를 함께 반환합니다." |
| 구현 메모 line 125-127 | `is_liked` / `is_mine` 둘 다 명시 |
| Response Body 스키마 표 (line 60-72) | `is_mine`만 있고 **`is_liked` 누락** |
| JSON 예시 (line 75-103) | **`is_liked` 누락** |

본문과 구현 메모를 정답으로 판단해 스키마 표 1행 + 예시 JSON 2곳에 `is_liked` 필드를 추가. 기존 GET /comments 구현 및 응답 구조와도 일관성 유지.

---

### 작업 6 — 22케이스 직접 검증 (로컬 서버 + 운영 RDS SSM 터널)

브랜치 작업 후 `npm run dev`로 로컬 서버 백그라운드 실행 + AWS SSM 포트 포워딩 터널로 운영 RDS 접속. `test-consumer@judam.com`(user_id=2) / `test-brewery@judam.com`(user_id=3) 두 토큰으로 검증.

**POST /replies — 5/5 통과**

| 케이스 | HTTP | 메시지 |
|---|---|---|
| 정상 (CONSUMER) | 201 | `대댓글이 등록되었습니다.` |
| 빈 content | 400 | `대댓글 내용을 입력해 주세요.` |
| 토큰 없음 | 401 | `유효하지 않거나 만료된 토큰입니다.` |
| 존재 안 함 commentId | 404 | `부모 댓글을 찾을 수 없습니다.` |
| post/comment mismatch | 404 | `부모 댓글을 찾을 수 없습니다.` |

**GET /replies — 5/5 통과**

| 케이스 | 결과 |
|---|---|
| 비로그인 | `is_liked=false`, `is_mine=false` 모두 false |
| CONSUMER 로그인 | comment 14 `is_mine=true`, 15 `is_mine=false` |
| BREWERY 로그인 | comment 14 `is_mine=false`, 15 `is_mine=true` |
| 부모 없음 | `replies:[]`, `totalElements:0`, `totalPages:1`, `currentPage:0` |
| size=1 페이지네이션 | 1건 반환, `totalElements:2`, `totalPages:2`, `currentPage:0` |

**DELETE — 12/12 통과 (기존 `DELETE /api/posts/{postId}/comments/{commentId}`가 대댓글 ID도 그대로 처리)**

| 케이스 | HTTP | 메시지 |
|---|---|---|
| 타인 시도 | 403 | `본인이 작성한 댓글만 삭제할 수 있습니다.` |
| 토큰 없음 | 401 | `유효하지 않거나 만료된 토큰입니다.` |
| 존재 안 함 commentId | 404 | `해당 댓글을 찾을 수 없습니다.` |
| post/comment mismatch | 404 | `해당 댓글을 찾을 수 없습니다.` |
| CONSUMER 자기 대댓글 삭제 | 200 | `댓글이 삭제되었습니다.` |
| BREWERY 자기 대댓글 삭제 | 200 | `댓글이 삭제되었습니다.` |
| 사후 GET /replies (빈 배열 확인) | 200 | `replies:[], totalElements:0` |
| **CASCADE 시나리오 5단계** | — | 새 루트 16 → 자식 17·18 생성 → GET /replies 2건 → 루트 16 삭제 200 → GET /replies 빈 배열 |

응답 바디는 명세서와 필드명·타입·메시지·중첩 구조까지 100% 일치.

---

### 작업 7 — 대댓글 삭제 별도 API 불필요 확인

기존 `DELETE /api/posts/{postId}/comments/{commentId}`가 단일 행 DELETE 방식이라 대댓글 ID로 호출해도 그대로 동작한다. 추가로 자기참조 FK `ON DELETE CASCADE`(5/29 마이그레이션)가 걸려 있어서 루트 댓글을 삭제하면 자식 대댓글이 자동으로 함께 정리된다.

검증 결과 별도 대댓글 삭제 API를 만들 필요가 없음을 확인. 14주차 DailyToDo의 "대댓글 삭제는 기존 DELETE가 커버" 명시 사항이 실제 데이터로 입증됨.

---

### 참고사항

- 대댓글 작성 시 `posts.comment_count`는 갱신하지 않는 정책(레시피 대댓글 API와 동일)을 채택했다. 게시글 상세/목록에서 노출되는 `comment_count`는 "루트 댓글 수" 의미를 유지하며, 대댓글 수는 GET /comments 응답의 각 댓글별 `reply_count` 서브쿼리로 확인할 수 있다.
- 명세서가 침묵한 부분(`posts.comment_count` 정책)을 사용자에게 사전 확인한 뒤 결정했고, 메모리에 [[feedback_api_spec_priority]] + [[feedback_path_param_validation]] 규칙을 적용해 작업했다.
- 검증 시 한글 입력이 윈도우 bash 코드페이지 이슈로 깨지는 경우가 있었지만(예: 게시글 title), 응답 바디 자체는 ASCII + 명세서 메시지로 정상 반환되어 1:1 비교에는 영향이 없었다.
