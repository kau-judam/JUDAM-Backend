# 일일 보고서

* 날짜 : 6월 5일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : feature/post-comment-like (신규)

---

### 작업 0 — 14주차 시작 + 작업 범위

14주차 첫 날(금요일). DailyToDo 금요일 계획은 **게시글 댓글 좋아요 작업의 DB 준비 단계** — 브랜치 생성·테이블 구조 파악·DDL 작성 및 DB 반영 3종. 실제 API 구현(POST/DELETE 엔드포인트)은 내일(토) 일정.

작업 시작 시점 상태:
- `dev` 브랜치 최신화 완료(사용자가 직접 `git pull` 수행)
- 13주차 PR 모두 머지 완료(가정), 6/4 이후 트리 깨끗
- 운영 RDS 상태는 미확인 (오늘 확인 필요)

---

### 작업 1 — `feature/post-comment-like` 브랜치 생성

`dev`에서 분기. 브랜치 네이밍은 `00.DefaultContext/rules/API_주차별_계획.md` 14주차 섹션 명시 그대로.

```bash
git checkout -b feature/post-comment-like
```

5/31 `feature/post-like` 분기와 동일 패턴. 브랜치 종료(→ develop PR)는 6/6 API 구현 마무리 후 예정.

---

### 작업 2 — `post_comment_likes` 테이블 구조 파악 (ERD 스펙)

`00.DefaultContext/rules/[5.16]ERD.sql` 81번째 줄에서 정의 확인:

```sql
CREATE TABLE post_comment_likes (
  like_id    BIGSERIAL PRIMARY KEY,
  comment_id BIGINT    NOT NULL,
  user_id    BIGINT    NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_post_comment_likes              UNIQUE (comment_id, user_id),
  CONSTRAINT fk_post_comment_likes_comment FOREIGN KEY (comment_id) REFERENCES post_comments(comment_id) ON DELETE CASCADE,
  CONSTRAINT fk_post_comment_likes_user    FOREIGN KEY (user_id)    REFERENCES users(user_id)            ON DELETE CASCADE
);
```

**구조 요약**
- `like_id` BIGSERIAL PK — 좋아요 1건마다 자동 증가하는 식별자
- `comment_id` BIGINT NOT NULL — 좋아요 대상 댓글 (FK → `post_comments.comment_id`)
- `user_id` BIGINT NOT NULL — 좋아요 누른 사용자 (FK → `users.user_id`)
- `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP — 등록 시각 자동 채움
- **UNIQUE `(comment_id, user_id)`** — 한 사용자가 같은 댓글에 중복 좋아요 차단(애플리케이션은 SQLSTATE `23505`로 판별, 5/31 `post_likes` 패턴과 동일)
- FK 2종 모두 `ON DELETE CASCADE` — 댓글/사용자 삭제 시 좋아요 행도 함께 정리(13주차 댓글 DELETE에서 FK cascade로 자동 정리되는 흐름 그대로)

9주차 `recipe_comment_likes` 테이블과 패턴 완전 동일(컬럼명/제약명 prefix만 `recipe_` → `post_`로 치환된 형태).

---

### 작업 3 — 운영 RDS 사전 검증 (AWS SSM 직접 조회)

5/31 `post_likes` 검증 때와 동일하게, DDL을 새로 작성하기 전에 **운영 RDS의 실제 상태부터 확인**.

**Step 1 — SSM 포트 포워딩 터널 열기** (`01.CommonRules/AWS_RDS_접속_메뉴얼.md` 절차)

```bash
aws ssm start-session --target i-0a746b7ff274b00dd \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"judam-db.crauqi4u0fb4.ap-northeast-2.rds.amazonaws.com\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"5433\"]}"
```

→ `Waiting for connections...` 확인 후 진행.

**Step 2 — 테이블 존재 여부 확인 (`psql`)**

```sql
SELECT table_name FROM information_schema.tables
 WHERE table_schema='public'
   AND table_name IN ('post_comment_likes','post_comments','post_likes','users')
 ORDER BY table_name;
```

결과: `post_comment_likes`, `post_comments`, `post_likes`, `users` 4행 모두 반환 → **`post_comment_likes` 테이블이 이미 존재**.

**Step 3 — 구조 상세 비교 (`\d post_comment_likes`)**

| 항목 | ERD 스펙 | 운영 RDS 실제 | 일치 |
|---|---|---|---|
| `like_id` | BIGSERIAL PK | `bigint NOT NULL` + `nextval('post_comment_likes_like_id_seq'::regclass)` (BIGSERIAL 동등) | ✅ |
| `comment_id` | BIGINT NOT NULL | `bigint NOT NULL` | ✅ |
| `user_id` | BIGINT NOT NULL | `bigint NOT NULL` | ✅ |
| `created_at` | TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP | `timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP` | ✅ |
| PK | `like_id` | `post_comment_likes_pkey` (btree on `like_id`) | ✅ |
| UNIQUE | `uq_post_comment_likes (comment_id, user_id)` | `uq_post_comment_likes UNIQUE CONSTRAINT, btree (comment_id, user_id)` | ✅ |
| FK comment | `fk_post_comment_likes_comment` → `post_comments(comment_id)` ON DELETE CASCADE | 동일 | ✅ |
| FK user | `fk_post_comment_likes_user` → `users(user_id)` ON DELETE CASCADE | 동일 | ✅ |

**결론**: 운영 RDS의 `post_comment_likes` 테이블이 ERD 스펙과 **완전히 일치하는 상태로 이미 존재**. 11주차 커뮤니티 DB 마이그레이션 시 함께 반영된 것으로 추정(13주차 5/31 `post_likes` 사전 검증 때와 동일한 상황).

→ **14주차에 신규 SQL 파일 작성·실행 불필요**. 검증만으로 "DDL 작성 및 DB 반영" 작업 마무리.

---

### 추가/수정한 파일

코드 변경 0건. 오늘 작업은 브랜치 생성 + DB 사전 검증만. 내일(6/6) `POST`/`DELETE` 라우트·컨트롤러·서비스 구현부터 실제 코드 작업 시작.

---

### 세부사항

**왜 DDL을 새로 작성하지 않았는가**: 동작원칙 #2 "판단 근거가 필요하면 문서를 먼저 확인"에 따라, ERD `.sql` 파일과 운영 RDS 실제 구조를 모두 확인한 결과 둘이 완전히 일치하는 상태였다. 같은 DDL을 다시 실행하면 `ERROR: relation "post_comment_likes" already exists`로 실패하거나 `IF NOT EXISTS` 방어 패턴이 필요한데, 어느 쪽도 의미 있는 변경이 아니므로 작성 자체를 생략. 동일한 판단 기준이 13주차 `post_likes`(5/31)에도 적용된 적이 있고 결과적으로 무사고였음.

**11주차 마이그레이션과의 관계**: 11주차 작업이 "커뮤니티 DB 마이그레이션"이었고, 그 시점에 ERD `.sql` 전체가 일괄 반영되었을 가능성이 높다. 단, 본 일일 보고서 시점에는 11주차 실행 기록을 재확인하지 않았으므로 "추정"으로만 표기했다. 향후 14주차 마지막 검토(6/11) 때 `database/` 폴더의 11주차 마이그레이션 SQL 파일을 열어 `post_comment_likes`가 명시적으로 포함되어 있었는지 확인하면 추정을 사실로 굳힐 수 있다.

**내일(6/6) 작업 진입 시 주의점**:
- 라우트 경로는 `/posts/{postId}/comments/{commentId}/likes` — `postId`와 `commentId` 두 path param 모두 정수·양수 검증 필요(메모리 [[feedback_path_param_validation]] — 13주차 mismatch 회귀 버그 교훈 그대로 적용)
- 서비스 쿼리는 `WHERE comment_id = $1 AND post_id = $2`로 묶어 mismatch 시 404 통일(13주차 댓글 CRUD 5/30 패턴 그대로)
- POST 응답 status는 200 (201 아님, 13주차 `post_likes` POST와 동일 컨벤션 — 명세서 우선)
- UNIQUE `23505` catch → 400 `이미 좋아요한 댓글입니다.` (정확한 메시지는 6/6 명세서 정독 시 확인)
- `posts.comment_count` 변경 없음(좋아요는 댓글 자체에만 영향) — `post_comments.like_count` +1/-1만 필요(테이블에 `like_count` 컬럼 있음, 13주차 마이그레이션에서 반영됨)
