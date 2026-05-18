# 일일 보고서

* 날짜 : 5월 16일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : feature/post-basic

---

### 작업 1 — 실제 DB 구조 조회 및 ERD 문서 최신화

**왜 이 작업을 했나**: 오늘 DailyToDo에는 `POSTS` / `COMMENTS` 테이블에 컬럼을 추가하는 DB 마이그레이션이 예정되어 있었다. 그런데 실제로 SQL을 실행하기 전에 현재 DB 상태를 먼저 확인해야 했다.

**확인 방법**: AWS SSM 포트 포워딩으로 로컬 5433 포트에 RDS 터널을 열고, `psql`로 모든 테이블의 컬럼 구조를 조회했다.

**결과**: 오늘 예정된 마이그레이션(컬럼 추가·타입 변경·POST_IMAGES 테이블 생성)이 **이미 DB에 적용된 상태**였다. 즉, ALTER TABLE을 실행할 필요가 없었다.

**추가 발견 사항**: 기존 ERD 문서(`[5.13]ERD.sql`)와 실제 DB를 비교했더니 두 테이블에서 컬럼이 누락된 것이 발견됐다.

| 테이블 | ERD에 없던 컬럼 |
|--------|----------------|
| `funding_support_options` | `volume VARCHAR(50)`, `alcohol VARCHAR(50)` |
| `orders` | `supporter_email VARCHAR(255)`, `support_message TEXT`, `postal_code VARCHAR(20)` |

이 차이를 반영하여 새 ERD 파일 `[5.16]ERD.sql`을 작성하고, 기존 `[5.13]ERD.sql`은 삭제했다.

---

### 작업 2 — `feature/post-basic` 브랜치 생성

`dev` 브랜치를 최신화한 뒤 `feature/post-basic` 브랜치를 생성했다. 이 브랜치에서 커뮤니티 게시글 작성·목록 조회 API를 개발한다.

---

### 작업 3 — `POST /api/posts` 게시글 작성 API 구현

**이 API가 하는 일**: 로그인한 사용자가 커뮤니티 게시글을 작성한다. 이미지는 클라이언트가 S3에 미리 업로드한 뒤 URL을 배열로 전달하는 방식이다 (레시피 이미지 업로드와 동일한 패턴).

**요청 형식**

```http
POST /api/posts
Authorization: Bearer {token}
Content-Type: application/json

{
  "title": "게시글 제목",
  "content": "본문 내용",
  "board_type": "FREE",
  "image_urls": ["https://s3.../img1.jpg"]
}
```

`board_type` 허용값: `FREE`(자유게시판), `TASTING_REVIEW`(시음후기), `RECIPE_DISCUSSION`(레시피토론)

**응답 형식** (201 Created)

```json
{
  "status": 201,
  "message": "게시글이 작성되었습니다.",
  "post": {
    "post_id": 1,
    "title": "게시글 제목",
    "board_type": "FREE",
    "user_id": 2,
    "nickname": "테스트소비자",
    "like_count": 0,
    "comment_count": 0,
    "image_urls": ["https://s3.../img1.jpg"],
    "created_at": "2026-05-16T05:33:05.912Z"
  }
}
```

**내부 동작 순서**:
1. 필수 필드(`title`, `content`, `board_type`) 누락 검사
2. `board_type` 유효성 검사 (허용된 3가지 값인지 확인)
3. `image_urls` 배열 길이 검사 (최대 5개)
4. DB 트랜잭션 시작
5. `posts` 테이블에 게시글 INSERT → 작성자 닉네임을 `users` 테이블과 JOIN하여 한 번에 조회
6. `post_images` 테이블에 이미지 URL을 `sequence`(0, 1, 2...) 순서로 INSERT
7. 트랜잭션 COMMIT → 응답 반환

트랜잭션을 사용한 이유: 게시글 INSERT가 성공한 뒤 이미지 INSERT가 실패하면 고아 게시글이 생기기 때문에, 둘 다 성공해야 최종 저장되도록 묶었다.

**생성된 파일**

| 파일 | 역할 |
|------|------|
| `src/services/postService.js` | DB 쿼리 (INSERT posts + post_images 트랜잭션) |
| `src/controllers/postController.js` | 요청 검증 + 서비스 호출 + 응답 반환 |
| `src/routes/postRoutes.js` | 라우터 정의 (`POST /` → authMiddleware → postPost) |
| `app.js` | `/api/posts` 경로로 라우터 등록 |

---

### 작업 4 — 로컬 테스트 완료

서버를 실행하고 아래 5가지 케이스를 직접 확인했다.

| 테스트 케이스 | 예상 | 결과 |
|---|---|---|
| 정상 요청 (이미지 2개 포함) | 201, post 객체 반환 | ✅ 통과 |
| 필수 필드 누락 (`content` 없음) | 400 | ✅ 통과 |
| 유효하지 않은 `board_type` | 400 | ✅ 통과 |
| 이미지 6개 전달 (5개 초과) | 400 | ✅ 통과 |
| 인증 토큰 없이 요청 | 401 | ✅ 통과 |

DB 직접 조회 결과 `posts` 테이블 1건, `post_images` 테이블 2건 정상 저장 확인.

(이미지 : Thunder Client 또는 curl에서 POST /api/posts 요청 201 응답 캡처)
(이미지 : DBeaver에서 posts 테이블과 post_images 테이블 저장 결과 확인 캡처)
