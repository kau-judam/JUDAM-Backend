# 일일 보고서

* 날짜 : 6월 8일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : feature/mypage-posts

---

### 작업 1 — DB 마이그레이션 필요 여부 점검 (결론: 불필요)

마이페이지 게시글 3종 API가 명세서대로 동작하려면 어떤 테이블/컬럼이 있어야 하는지 먼저 정리하고, 운영 DB의 실제 상태와 대조했다.

| 요구 컬럼 | 사용 위치 | 상태 |
|---|---|---|
| `posts(user_id, title, board_type, like_count, comment_count, created_at)` | 14-03 응답 | ✅ 존재 |
| `post_likes(user_id, post_id, created_at)` + `posts` JOIN | 14-04 응답 | ✅ 존재 |
| `post_comments(user_id, content, like_count, created_at, updated_at)` + `posts` JOIN | 14-05 응답 | ✅ 존재 (13주차에 `like_count`/`updated_at` 추가됨) |

→ 신규 마이그레이션 SQL 파일 작성 불필요. 코드 작업으로 바로 진입.

> `database/schema.sql`에 `posts.board_type` 정의가 빠져 있으나 이는 별개의 schema 동기화 이슈이며 운영 DB와 무관(`[5.16]ERD.sql`에는 정의되어 있고 게시글 작성·목록 API가 이미 정상 동작).

---

### 작업 2 — `GET /api/users/me/posts` 마이페이지 내 게시글 (최근 3개) 구현

**이 API가 하는 일**: JWT로 인증된 사용자가 본인이 작성한 게시글 중 가장 최근 3개를 반환한다. 마이페이지에서 "내 게시글" 미리보기 카드용. 페이지네이션은 없고 LIMIT 3 고정.

**쿼리 구조**

- `posts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 3`
- 별도 COUNT 쿼리로 `totalElements`(LIMIT 전 전체 게시글 수) 반환 — 마이페이지의 "전체 보기" 버튼 활성화 여부 판단용

**응답 구조**

```json
{
  "posts": [
    { "post_id": 17, "title": "...", "board_type": "INFO",
      "like_count": 0, "comment_count": 0, "created_at": "..." }
  ],
  "totalElements": 16
}
```

---

### 작업 3 — `GET /api/users/me/likes/posts` 내가 좋아요 누른 게시글 목록 구현

**이 API가 하는 일**: 인증된 사용자가 좋아요 누른 게시글 목록을 페이지네이션으로 반환. 응답에 `liked_at`(좋아요 등록 시각) 필드가 별도로 들어간다 — 좋아요 누른 시점 기준 정렬 결과를 그대로 노출.

**쿼리 구조**

- `post_likes pl JOIN posts p ON p.post_id = pl.post_id WHERE pl.user_id = $1 ORDER BY pl.created_at DESC`
- `pl.created_at AS liked_at` 별칭으로 명세 필드명 매칭
- COUNT는 `post_likes WHERE user_id = $1` (좋아요 누른 게시글 기준)

**쿼리 파라미터**: `page`(0부터, 기본 0) / `size`(기본 20)

---

### 작업 4 — `GET /api/users/me/post-comments` 내가 쓴 게시글 댓글 목록 구현

**이 API가 하는 일**: 인증된 사용자가 작성한 게시글 댓글 목록을 페이지네이션으로 반환. 각 댓글에 어느 게시글에 달았는지 알 수 있도록 nested `post` 객체(post_id/title/board_type)가 포함된다.

**쿼리 구조**

- `post_comments pc JOIN posts p ON p.post_id = pc.post_id WHERE pc.user_id = $1 ORDER BY pc.created_at DESC`
- `json_build_object('post_id', p.post_id, 'title', p.title, 'board_type', p.board_type) AS post` — 명세서의 중첩 `post` 객체 구조를 SQL 측에서 직접 생성
- `updated_at`은 수정한 적 없으면 `null`로 그대로 반환

---

### 작업 5 — 라우트 등록 + 미인증 401 응답 확인

라우트 3개를 `src/routes/userRoutes.js`에 추가하고, 모두 `authMiddleware`를 통과하도록 연결. `authMiddleware`가 토큰 없거나 만료 시 반환하는 응답이 명세서와 일치하는지 확인.

| 항목 | 명세서 | 실제 |
|---|---|---|
| HTTP 코드 | 401 | 401 ✅ |
| body | `{"status": 401, "message": "유효하지 않거나 만료된 토큰입니다."}` | 동일 ✅ |

3개 엔드포인트 각각 헤더 없이 호출해서 401 응답 확인.

---

### 작업 6 — API 명세서 일관성 수정 (board_type 옛 값 6곳 정리)

응답 예시 검증 중 명세서에 `TASTING_REVIEW` / `RECIPE_DISCUSSION` 같이 **실제 허용값(`FREE`/`INFO`)에 없는 board_type 예시**가 남아 있는 걸 발견. 기획 단계에서 4종이었다가 11주차 작업 시 2종으로 단순화됐는데 본문은 갱신됐지만 예시 JSON은 옛 값이 그대로 남은 상태.

수정한 문서 4개 / 6개 라인:

| 명세서 파일 | 라인 | 변경 |
|---|---|---|
| 11주차/게시글 작성.md | 15 | 개요 문장 정리 ("자유게시판 / 시음후기 / 레시피토론" → "자유게시판(FREE) / 정보게시판(INFO)") |
| 11주차/게시글 작성.md | 72 | `TASTING_REVIEW` → `FREE` |
| 14주차/마이페이지 내 게시글 목록.md | 59 | `TASTING_REVIEW` → `FREE` |
| 14주차/마이페이지 내 게시글 목록.md | 67 | `RECIPE_DISCUSSION` → `FREE` |
| 14주차/마이페이지 좋아요 게시글 목록.md | 73 | `TASTING_REVIEW` → `FREE` |
| 14주차/마이페이지 내 게시글 댓글 목록.md | 81 | `TASTING_REVIEW` → `FREE` |

백엔드 코드 변경은 없음 (실제 코드는 처음부터 `FREE`/`INFO`만 처리). 프론트엔드 응답 예시 참조 시 정합성 확보.

---

### 작업 7 — 로컬 테스트 완료

`test-consumer@judam.com` (user_id=2) 계정으로 토큰 발급 후 3개 API + 미인증 401 케이스 검증.

| 테스트 | 결과 |
|---|---|
| `GET /api/users/me/posts` (인증) | 200, 최근 3개 + totalElements 16 |
| `GET /api/users/me/likes/posts?page=0&size=20` (인증) | 200, 빈 배열 + 페이지 메타 |
| `GET /api/users/me/post-comments?page=0&size=20` (인증) | 200, 4개 + nested `post` 객체 정상 |
| `GET /api/users/me/posts` (헤더 없음) | 401 + 명세 메시지 일치 |
| `GET /api/users/me/likes/posts` (헤더 없음) | 401 |
| `GET /api/users/me/post-comments` (헤더 없음) | 401 |

`board_type` 응답값도 모두 `FREE`/`INFO` 중 하나로 정상 반환됨을 확인.

---

### 참고사항

- 14주차 신규 라우트 3개는 기존 `/me/recipes`, `/me/interests/recipes`, `/me/recipe-comments`(9주차)와 segment가 모두 다르므로 라우트 매칭 충돌 없음.
- 코드 패턴은 9주차 마이페이지 레시피 구현(`mypageController.js` / `mypageService.js`)과 완전히 동일 — JWT 식별은 `req.user.id`, 페이지네이션은 `Math.max(0, parseInt(...))`/`Math.max(1, parseInt(...))`, 500 catch, 401은 미들웨어 일임.
- 14주차 brunch 화·수·목은 통합 테스트 + PR 준비 + 버퍼이므로 코드 변경은 없음.
