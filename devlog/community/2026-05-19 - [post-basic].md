# 일일 보고서

* 날짜 : 5월 19일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : feature/post-basic

---

### 작업 1 — `GET /api/posts` 게시글 목록 조회 구현

**이 API가 하는 일**: 커뮤니티 게시판에 등록된 게시글 목록을 반환한다. 로그인하지 않은 사용자도 접근할 수 있다.

**쿼리 파라미터 4가지 지원**

| 파라미터 | 설명 | 기본값 |
|---|---|---|
| `board_type` | `ALL`(전체) / `FREE`(자유) / `INFO`(정보) — 그 외 값은 400 반환 | ALL |
| `sort` | `newest`(최신순) / `popular`(인기순 = like_count 내림차순) | newest |
| `page` | 페이지 번호 (0부터 시작) | 0 |
| `size` | 페이지당 항목 수 | 20 |

**응답 구조** — 목록 카드에 필요한 필드만 포함 (본문 content 제외)

```json
{
  "posts": [
    {
      "post_id": 1,
      "title": "복숭아 막걸리 시음 후기",
      "board_type": "FREE",
      "user_id": 5,
      "nickname": "막걸리마니아",
      "author_profile_image": "https://s3.../profile.png",
      "like_count": 12,
      "comment_count": 5,
      "thumbnail_url": "https://s3.../img.png",
      "created_at": "2026-05-16T10:00:00",
      "is_liked": true,
      "is_mine": false
    }
  ],
  "totalElements": 45,
  "totalPages": 3,
  "currentPage": 0
}
```

**비로그인 허용**: `optionalAuthMiddleware`를 사용해 토큰이 없어도 요청을 처리한다. 이 경우 `is_liked`와 `is_mine`은 항상 `false`로 반환된다.

**비로그인 시 false 처리 방식**: SQL 레벨에서 자동으로 처리된다.
- `is_liked` — `LEFT JOIN post_likes ON ... AND pl.user_id = $N` 에서 $N이 null이면 JOIN 조건이 항상 false가 되어 pl.like_id가 null → false 반환
- `is_mine` — `CASE WHEN p.user_id = $N` 에서 $N이 null이면 비교 결과가 null(false) → false 반환
- 코드에서 null 분기를 별도로 작성하지 않아도 자연스럽게 false 처리

**thumbnail_url**: `post_images` 테이블에서 `sequence = 0`인 이미지의 URL을 가져온다. 이미지가 없으면 null.

**수정한 파일 3개**

| 파일 | 변경 내용 |
|---|---|
| `src/routes/postRoutes.js` | `optionalAuthMiddleware` + `GET /` 라우트 추가 |
| `src/controllers/postController.js` | `getPosts` 핸들러 추가, board_type 유효성 검증 |
| `src/services/postService.js` | `getPostList` 함수 추가 (SQL 분기, Promise.all 병렬 쿼리) |

---

### 작업 2 — API 명세서 `board_type` 예시 수정 및 400 케이스 추가

명세서(`게시글 목록 조회.md`)에 구버전 board_type 값이 예시에 그대로 남아 있는 것을 발견했다. 5/17에 프론트와 합의하여 `FREE`/`INFO` 2종으로 변경했는데, 명세서 예시만 업데이트되지 않은 상태였다.

**수정한 내용**

| 위치 | 수정 전 | 수정 후 |
|---|---|---|
| Query Parameter 예시 | `board_type=TASTING_REVIEW` | `board_type=FREE` |
| 응답 본문 예시 1 | `"board_type": "TASTING_REVIEW"` | `"board_type": "FREE"` |
| 응답 본문 예시 2 | `"board_type": "RECIPE_DISCUSSION"` | `"board_type": "INFO"` |
| 실패 케이스 | 500만 존재 | 400 (`유효하지 않은 board_type입니다.`) 추가, 기존 500은 FAIL 2로 변경 |

---

### 작업 3 — 로컬 테스트 완료

Thunder Client로 아래 6개 케이스 직접 확인.

| 테스트 | 결과 |
|---|---|
| `GET /api/posts` (전체 조회, 비로그인) | 200, is_liked=false, is_mine=false |
| `GET /api/posts?board_type=FREE` (필터) | 200, FREE 게시글만 반환 |
| `GET /api/posts?board_type=XYZ` (잘못된 값) | 400 반환 |
| `GET /api/posts?sort=popular` (인기순) | 200, like_count 내림차순 정렬 |
| `GET /api/posts` (Authorization 헤더 포함) | 200, is_liked/is_mine 실제 값 반영 |
| `GET /api/posts?page=1&size=5` (페이지네이션) | 200, currentPage=1 |
