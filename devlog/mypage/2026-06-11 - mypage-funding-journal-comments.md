# 일일 보고서

* 날짜 : 6월 11일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : feature/mypage-funding-journal-comments

---

### 배경 — 프론트 추가 요청(6.11) 마이페이지 펀딩 탭 3종 점검

프론트 담당자가 `99.추가_작업_일정_문서/6.11/프론트엔드요청사항.md`로 마이페이지 > 나의 활동 > 펀딩 탭(관심·댓글·Q&A) 3종의 연결 상태를 전달. 각 항목을 백엔드·프론트 코드와 실 운영 DB로 교차 확인해 **신규 구현 1건(댓글)·프론트 수정 사안 1건(Q&A)·조치 불요 1건(관심)** 으로 분류.

---

### 점검 1 — 관심 펀딩: 조치 불요

`GET /api/mypage/activity/interests?type=FUNDING`은 기존 `getMyActivityInterests`가 `funding_likes` + `funding_projects`로 FUNDING을 이미 처리(명세 14-94 일치). 백엔드 변경 없음.

---

### 점검 2 — 펀딩 Q&A: 백엔드 정상, 프론트 응답 키 불일치 (백엔드 무수정)

요청서는 "`activity/qna`가 작성 Q&A를 안 내려준다"고 추정했으나, 백엔드 `getMyActivityQna`는 명세(14-92)대로 `funding_questions`에서 본인 작성분을 정상 조회·응답 중. 실제 원인은 **응답 배열 키 불일치**:

- 백엔드 응답 키 = **`qnas`** (명세 14-92 규정, 관심=`interests`·댓글=`comments`와 동일한 복수형 컨벤션).
- 프론트 Q&A 파서(`11.Github_FrontendCodes/src/features/mypage/api.ts:872` `normalizeMyPageActivityQnaResult`)가 배열을 꺼낼 때 시도하는 키 = `['qna','questions','content','items','list']` → **`qnas` 누락** → 빈 배열 처리.
- 같은 파일에서 관심은 `data.interests`, 댓글은 `data.comments`로 복수형 키를 그대로 읽으면서 Q&A만 자기 코드와도 불일치.

→ 백엔드는 명세 준수로 무수정. 프론트에 "api.ts:872 키 목록 맨 앞에 `qnas` 추가" 전달(완료).

(프론트 펀딩 활동 화면 `MyActivityCategoryScreen.tsx`는 6.11 시점에 관심·Q&A를 실제 API로 막 연결한 상태이고, 댓글 탭은 하드코딩 빈 배열로 아래 신규 API를 대기 중.)

---

### 작업 3 — `GET /api/mypage/activity/funding-journal-comments` 신규 구현 (펀딩 "댓글" 탭)

요청서의 "펀딩 댓글"은 **펀딩 양조일지(`brewery_logs`)에 단 댓글**을 의미. 기존 `activity/comments`는 명세상 RECIPE/POST 전용이라 섞을 수 없어 **별도 엔드포인트**로 신설.

- **명세서**: `00.DefaultContext/API 문서/14주차/마이페이지 활동 펀딩 댓글(양조일지) 목록.md` (14-95) 신규 작성.
- **데이터 소스**: `brewery_log_comments` → `brewery_logs` → `funding_projects` INNER JOIN, `WHERE blc.user_id = 본인`, `created_at DESC`, page/size 페이지네이션(기본 0/20, 최대 100).
- **응답 필드**: commentId·fundingId·fundingTitle·breweryLogId·breweryLogTitle·breweryLogCreatedAt·content·createdAt·updatedAt + totalElements/totalPages/currentPage. (요청서 "필요한 응답 값" 9개를 1:1 매핑, "양조일지 제목 또는 작성일"은 title·createdAt 둘 다 제공)
- **댓글/답글 모두 포함**: `parent_comment_id` 값과 무관하게 본인 작성분 전부.
- **삭제 반영**: `brewery_log_comments`는 소프트삭제 컬럼 없이 하드삭제 → 삭제 댓글은 테이블에 없어 자연 제외. 양조일지/펀딩 삭제분은 INNER JOIN으로 제외(레시피/게시글 댓글의 "원문 삭제 시 제외"와 동일 동작).

코드는 기존 활동 API 옆에 동일 패턴으로 추가: `mypage.service.js`(함수 1 + export), `mypage.controller.js`(컨트롤러 1 + import/export), `mypage.routes.js`(라우트 1). 신규 파일·DB 마이그레이션 없음(기존 테이블만 사용).

---

### 작업 4 — 로컬 검증 (실 운영 DB, 명세 타입까지 1:1)

로컬 서버(`npm start`, SSM 터널 5433 → 운영 RDS) + 데이터 보유 계정 `user@judam.test`(uid=19, 양조일지 댓글 5건)로 직접 호출. `pg_catalog`로 3개 테이블 컬럼(`brewery_log_comments`/`brewery_logs`/`funding_projects`)을 사전 확인해 쿼리 컬럼명을 실 DB와 맞춤.

| 테스트 | 결과 |
|---|---|
| funding-journal-comments (uid=19) | 200, 3건 — 12필드·**타입**(Long→number/String→string/Array)·필드 순서 명세 일치 |
| 일시 3종(breweryLogCreatedAt/createdAt/updatedAt) | ISO 8601 UTC(밀리초·`Z`), 예 `2026-05-28T21:32:10.833Z` — 명세 포맷 일치 |
| 잘못된 토큰 | 401 `"유효하지 않거나 만료된 토큰입니다."` (FAIL 1 일치) |
| test-consumer(uid=2, 댓글 0건) | 200, `{comments:[],totalElements:0,…}` 빈 목록 정상 |

- **FK 무결성**: 응답의 `fundingId`/`breweryLogId`는 클라이언트 입력이 아니라 댓글에서 FK 체인(`blc.brewery_log_id→bl.log_id`, `bl.funding_id→fp.funding_id`)을 거슬러 유도한 값. 실 DB로 comment 55→log 28→funding 35 등 체인 일치 확인. "자식 ID만 존재하면 통과하던" 부모-자식 불일치 버그류는 본 API가 부모 ID를 입력으로 받지 않아 구조적으로 발생 불가.

---

### 참고사항

- **명세 위치**: 14-95 명세는 백엔드 repo 밖(`00.DefaultContext`) 문서라 이 브랜치 커밋에는 코드 3파일만 포함될 예정.
- **미커밋·미배포**: 현재 `feature/mypage-funding-journal-comments`(dev 분기) 로컬 브랜치에 코드만 존재(커밋/푸시 전). 운영(AWS)은 PR 머지+배포 전까지 본 엔드포인트 없음(404).
- **프론트 액션 대기**: Q&A는 프론트 `api.ts:872`에 `qnas` 키 추가, 댓글 탭은 본 신규 엔드포인트 연결 필요.
