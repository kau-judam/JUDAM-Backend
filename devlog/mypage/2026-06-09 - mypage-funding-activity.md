# 일일 보고서

* 날짜 : 6월 9일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : feature/mypage-funding-activity

---

### 배경 — 프론트 추가 요청(6.2) 마이페이지 API 묶음

프론트 담당자가 `99.추가_작업_일정_문서/6.2/`로 2건을 전달.

- **문서 1** — 마이페이지 화면 구현에 필요한 API 묶음(요약 버그·참여펀딩 필드 추가·배송 버튼·주문/배송 상세·활동 목록). 실제로는 6개 엔드포인트.
- **문서 2** — 펀딩 마감/성공·실패 처리 정책 공유(FYI). 검증 결과 cron·주문 방어·`settle-expired`까지 이미 구현·일치 → 산출물 없음.

명세서 5신규+1수정을 14주차 폴더에 작성·1:1 검토하고, `feature/mypage-funding-activity`(dev 분기)에서 구현.

---

### 작업 1 — `GET /api/mypage/summary` archiveCount 버그 수정

`archiveCount`가 아카이브를 삭제해도 줄지 않는 버그. 원인은 `getArchiveCount`가 `user_archives`를 `deleted_at` 조건 없이 전부 `COUNT`한 것. soft delete를 반영하도록 `AND deleted_at IS NULL` 추가(목록 조회 `getMyArchives`와 동일 기준). 이제 삭제 시 1 감소.

---

### 작업 2 — `GET /api/mypage/fundings/participated` 필드 보강 + excludeArchived

기존 참여펀딩 목록에 프론트 요구 8필드 추가.

| 추가 필드 | 출처/계산 |
|---|---|
| myAmount | 해당 펀딩 본인 PAID 주문들의 `total_amount` **합산**(SUM) |
| participatedAt | 대표 주문(orderId)의 `created_at` |
| currentAmount / goalAmount | `funding_projects.current_amount` / `goal_amount` |
| progressRate | `current/goal*100` (소수1자리 반올림, goal 0이면 0) |
| canViewDelivery | `fundingStatus==='SUCCESS'` AND 배송정보 존재 |
| deliveryStatus / hasTrackingNumber | `funding_deliveries` 운송장 존재 여부 기반 |

- **excludeArchived 파라미터**: 기존 엔드포인트는 *아카이브 작성 picker*용이라 항상 "이미 기록한 펀딩"을 제외했는데, 6.2의 일반 마이페이지 목록은 전체가 나와야 자연스럽다. 기본값 `false`(전체), 아카이브 picker만 `excludeArchived=true`로 호출하도록 단일 엔드포인트에 스위치 추가. → 요약의 `participatedFundingCount`(전체 집계)와 목록 건수 일치. (백엔드 호출부는 컨트롤러 1곳뿐이라 프론트가 picker 화면에서만 파라미터 추가하면 됨)

---

### 작업 3 — `GET /api/mypage/fundings/orders/{orderId}` 주문·배송 상세 신규

- Path param `orderId` 정수 검증(아니면 400), `orders.order_id=$1 AND user_id=본인`으로 **소유권 확인**(없거나 타인 주문이면 404로 통일).
- `orders` + `funding_projects` + `brewery_auth`(LATERAL) + `funding_support_options`(리워드명) JOIN.
- `paidAmount = total_amount − shipping_fee`, 수령인은 `orders.recipient_*`/`shipping_address(+detail)`.

---

### 작업 4 — `GET /api/mypage/activity/{interests|comments|qna}` 활동 목록 3종 신규

대상 종류를 `targetType`으로 통합. 응답은 명세대로 bare 형식(`{ <key>, totalElements, totalPages, currentPage }`).

| 엔드포인트 | 통합 소스 |
|---|---|
| interests | `recipe_interests`(RECIPE) + `post_likes`(POST) + `funding_likes`(FUNDING) UNION |
| comments | `recipe_comments`(RECIPE) + `post_comments`(POST) UNION, 원문 삭제분은 JOIN으로 자연 제외 |
| qna | `funding_questions` + `funding_question_replies`(최근 1건) — `hasAnswer` 분기, ANSWERED/WAITING |

- `page`/`size` 페이지네이션(기본 0/20, size 최대 100), 정렬 최신순.

---

### 작업 5 — 배송 권한 이슈 대비 graceful degrade

`funding_deliveries` 소유자가 `judam_jaewon`(양재원)이고 앱 DB 계정(`judam_yohan`)에 SELECT 권한이 없을 수 있다. 배송 조회를 별도 try/catch로 분리해, 권한이 없어도 목록/상세가 **200 정상 응답**하고 배송 필드만 빈값(`null`/`false`)으로 degrade되게 했다. (하드 JOIN이면 500으로 터졌을 부분)

---

### 작업 6 — 로컬 검증 (실 운영 DB, 명세 1:1 대조)

로컬 서버(`npm start`, SSM 터널) + 토큰으로 직접 검증. 데이터 있는 계정(`user@judam.test` uid=19, `brewery@judam.test` uid=18) 사용.

| 테스트 | 결과 |
|---|---|
| summary | 200, archiveCount soft-delete 반영 |
| participated (uid=19) | 200, 펀딩 3건 — 19필드 순서·myAmount 합산·progressRate(9.1/77.7) 일치 |
| orders/{id} valid | 200, paidAmount=total−shipping(14111−3000=11111) |
| orders/abc | 400 "유효하지 않은 주문 ID입니다." |
| orders/999999 | 404 "주문을 찾을 수 없습니다." |
| activity comments | 200, 8건(RECIPE/POST, targetTitle·updatedAt) |
| activity qna | 200, 2건(hasAnswer=true, ANSWERED) |
| activity interests (uid=18) | 200, 4건(FUNDING, summary·thumbnailUrl) |

- 배송 필드는 모두 `null`(judam_yohan 권한 없음 → degrade 정상 동작 확인).

---

### 참고사항

- **명세 보강 1건**: 1:1 검증 중 실 운영 DB `funding_projects.status`에 `REJECTED`(관리자 반려) 값이 존재하나 명세 enum에 빠져 있어 명세에 추가. 코드는 status를 그대로 통과시켜 원래 정상.
- **배송 상태/시각 필드 미완**: `deliveryStatus`/`shippedAt`/`deliveredAt`은 `funding_deliveries`에 대응 컬럼이 없어 명세에 `[테이블 컬럼 추가 필요]`로 표기 + 컬럼 추가 마이그레이션 초안(`6.2/20260602_funding_deliveries_status_columns.sql`) 작성. 실행은 소유자(양재원) 권한 필요.
- **ERD 보강**: 실 운영 DB 재조회 결과 `judam_yohan` 권한에 가려져 information_schema에 안 보이던 5개 테이블(`funding_deliveries` 등)을 `pg_catalog`로 확인해 `[6.2]DB스키마.md`에 추가(52→57개).
- 신규 코드는 기존 mypage 함수 옆에 동일 패턴 추가: `mypage.service.js`(함수 6 + 헬퍼), `mypage.controller.js`(컨트롤러 4), `mypage.routes.js`(라우트 4). 신규 파일 없음.
- DB 마이그레이션 없음(배송 컬럼 추가는 별건·대기). 기존 테이블만 사용.
- 커밋: `feat: 마이페이지 참여펀딩·주문배송·활동 목록 API 구현 (archiveCount 수정 포함)`
