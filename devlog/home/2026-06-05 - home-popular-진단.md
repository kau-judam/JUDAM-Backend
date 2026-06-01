# 일일 보고서

* 날짜 : 6월 5일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : 없음 (진단·조사 작업 — 코드 변경 없음)

---

### 작업 1 — DB 스키마 최신화 (실제 운영 DB 직접 조회)

기준 ERD 문서가 실제 운영 DB와 어긋났을 가능성이 있어, SSM 터널로 운영 DB에 직접 접속해 현재 스키마를 조회하고 문서를 새로 만들었다.

- 접속: AWS SSM 포트 포워딩(RDS 5432 → 로컬 5433), 백엔드 `db.js`와 동일하게 SSL(`rejectUnauthorized:false`) 적용.
- 조회 방법: `psql` 미설치 + `pg_dump` 버전 거부(서버 18.3 > 클라 17.9)라, 백엔드의 `pg` 패키지를 `node`로 직접 사용해 `information_schema` + `pg_catalog`(PK/FK/UNIQUE)를 추출.
- 결과: 실제 **52개 테이블** 확인. 읽기 쉬운 마크다운 표로 정리해 저장.
  - 저장 위치: `00.DefaultContext/rules/[5.30]DB스키마.md`
  - 구버전 ERD(`[5.27]` / `[5.16]`)는 폐기.
- 문서 상단에 **회원 유형 구분**(일반 vs 양조장)을 명시: `users.role`이 단일 기준(SSOT), `brewery_auth`(승인 이력)·`brewery_profiles`(공개 프로필 1:1)는 확장, `funding_projects.brewery_user_id`는 이름과 달리 `users.user_id`를 가리키는 논리 참조(실제 FK 제약 없음).

> 조사 중 일부 자동 조회 결과가 "신규 테이블 6개(shipping_addresses 등)"라고 잘못 보고했으나, 직접 조회로 그런 테이블은 없음을 확인(검증 완료).

---

### 작업 2 — 홈 "인기 레시피" 진단 (결론: PUBLISHED 한정 정상)

홈 화면은 "인기 펀딩 3개 + 인기 레시피 3개"를 인기순으로 보여줘야 한다. 회의 문서 증상은 "인기 레시피 목록은 불러오지만 상위 3개 정렬이 안 됨".

실서버 API `GET /api/recipes/popular` 응답과 실제 DB 정렬을 대조했다.

| 순위 | API 응답 | DB(PUBLISHED, interest_count DESC) |
|---|---|---|
| #1 | recipeId=4 (interest 2) | recipe_id=4 (interest 2) |
| #2 | recipeId=84 (interest 1) | recipe_id=84 (interest 1) |
| #3 | recipeId=33 (interest 0, 댓글 3) | 2차 정렬 comment_count로 id=33 |

- 백엔드 쿼리(`recipeService.getPopularRecipesForHome`): `WHERE status='PUBLISHED' ORDER BY GREATEST(캐시, 실제관심수) DESC, comment_count DESC, created_at DESC LIMIT 3` — 정렬·개수 모두 정확.
- → **펀딩으로 넘어가지 않은 레시피(PUBLISHED)의 인기 레시피 정렬은 백엔드 버그 아님.**

---

### 작업 3 — "정렬 안 됨" 증상의 실제 원인 규명

실제 DB에서 인기도 최상위 레시피는 **recipe_id=3, interest_count=105** 인데, 상태가 `FUNDING_READY`(이미 펀딩 전환됨)다.

- 홈 인기 레시피 API는 `status='PUBLISHED'`만 집계 → 105짜리가 빠지고 PUBLISHED 중 최대인 2/1/0만 노출.
- **팀 결정(이 작업일 기준): 펀딩으로 넘어간 레시피는 인기 레시피에서 제외(현행 유지)** → 이 동작은 정상이며 수정하지 않음.
- 부차 발견: recipe_id=3의 `interest_count=105`(캐시)와 실제 `recipe_interests` 행 수(0개)가 불일치 — 데모용 수동값으로 추정. 노출에는 영향 없으나 정합성 점검 대상으로 기록.

---

### 작업 4 — 홈 "인기 펀딩" 진단 (결론: 프론트 이슈)

홈 화면에 인기 펀딩이 아예 표시되지 않는 원인을 프론트 코드에서 확인했다.

- `HomeScreen.tsx`가 펀딩 목록을 **불러오지 않음**: `const { projects } = useFunding()`의 `projects` 초기값이 빈 배열인데, 홈 화면에 `getFundingList()` 호출이 없음.
- 결과: `sortFundingProjectsByPopularity([]).slice(0,3)` → 빈 배열 → "현재 인기 펀딩" 카드 0개.
- 백엔드: 인기 펀딩 전용 엔드포인트는 없으나(`/api/fundings/popular` 404), 기존 `GET /api/fundings?sort=POPULAR&size=3`이 `likeCount DESC`로 정상 동작(실서버 확인). → **백엔드 신규 작업 불필요**, 프론트가 호출만 추가하면 됨.

---

### 작업 5 — 에뮬레이터 실행 + 결과 문서화

- 안드로이드 에뮬레이터(`Pixel_7`) + Expo로 앱을 실제 실행해 홈 진입을 시도(조회 전용). 온보딩 화면 자동 조작에 한계가 있어, 화면 확인은 위 API/DB/코드 분석으로 대체해 진단을 확정.
- 진단 종합 결과를 프론트 담당자 인계용 문서로 작성: `99.추가_작업_일정_문서/홈화면_이슈_작업결과.md`

---

### 참고사항

- **백엔드 코드 변경 없음.** 인기 레시피는 정상(팀 결정대로 PUBLISHED만 노출), 인기 펀딩은 기존 엔드포인트로 충분.
- 핵심 후속 조치는 **프론트**: 홈 진입 시 인기 펀딩 로드 추가(`getFundingList({ sort: 'POPULAR', page: 0, size: 3 })` 권장). 상세 요청사항은 `홈화면_이슈_작업결과.md` 참고.
- 인기 레시피 프론트 fallback 주의: API 실패/지연 시 목업(`data.ts`의 `likes: 142/89/67`)이 화면에 남아 "정렬 이상"으로 보일 수 있음(정상 응답 시 실데이터로 교체됨).
- (정합성) recipe_id=3의 interest_count 캐시(105)와 실제 관심 행(0) 불일치 — 추후 점검 대상.
