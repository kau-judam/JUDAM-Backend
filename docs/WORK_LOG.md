# Work Log

이 문서는 JUDAM-Backend에서 진행된 주요 작업과 남은 작업을 추적하는 작업 로그입니다.
앞으로 Codex가 이 프로젝트에서 코드를 수정하거나 구조를 바꾸면 이 문서도 함께 갱신합니다.

## Update Rule

- 코드, DB, API, 문서 구조에 의미 있는 변경이 생기면 새 항목을 추가합니다.
- 변경 파일, 변경 이유, 검증 결과, 남은 작업을 같이 기록합니다.
- 펀딩 API처럼 별도 상태표가 필요한 큰 기능은 관련 상세 문서도 함께 갱신합니다.

## 2026-05-22

### Project Structure Refactor

완료:

- `app.js`의 라우트 import/mount 코드를 `src/routes/index.js`로 분리했습니다.
- Express 앱 하네스 역할은 `app.js`에, 라우트 마운트 표는 `src/routes/index.js`에 모았습니다.
- DB 연결 모듈을 `src/config/db.js` 기준으로 통일했습니다.
- 기존 `src/db.js`는 호환을 위해 `src/config/db.js`를 re-export하도록 변경했습니다.
- `src/config/db.js`의 DB 환경변수 console log를 제거했습니다.
- PostgreSQL `DATE` 컬럼을 `YYYY-MM-DD` 문자열로 유지하는 parser를 공통 DB 설정에 반영했습니다.

변경 파일:

- `app.js`
- `src/routes/index.js`
- `src/config/db.js`
- `src/db.js`

검증:

- `node -e "require('./app'); console.log('app loaded')"` 통과
- 전체 JS 파일 `node --check` 통과

### Harness And Documentation

완료:

- README에 하네스 파일 경로를 명시했습니다.
- 프로젝트 구조 문서 `docs/PROJECT_STRUCTURE.md`를 추가했습니다.
- 런타임 하네스 문서 `docs/HARNESS.md`를 추가했습니다.
- 펀딩 API 상태 문서 `docs/FUNDING_API_STATUS.md`를 추가했습니다.
- 현재 작업 로그 문서 `docs/WORK_LOG.md`를 추가했습니다.
- `.env.example`에 실제 코드에서 쓰는 환경변수를 보강했습니다.

변경 파일:

- `README.md`
- `.env.example`
- `docs/PROJECT_STRUCTURE.md`
- `docs/HARNESS.md`
- `docs/FUNDING_API_STATUS.md`
- `docs/WORK_LOG.md`

### Funding Agreement API

완료:

- `POST /api/fundings/agreements`가 7개 필수 약관을 모두 검사하도록 정리했습니다.
- 프론트 약관 키 `age`, `contact`, `settlement`, `fee`, `responsibility`, `license`, `ip`를 허용했습니다.
- 기존 camelCase, snake_case 요청 필드도 같이 받을 수 있게 했습니다.
- `isLicenseAgreed`, `isIpPolicyAgreed`, `allRequiredTermsAgreed` 저장 흐름을 반영했습니다.

변경 파일:

- `src/controllers/funding.controller.js`
- `database/20260522_funding_project_flow.sql`
- `docs/FUNDING_API_STATUS.md`

남은 작업:

- 실제 DB에 `database/20260522_funding_project_flow.sql` 적용 필요
- DB 연결 후 실제 `POST /api/fundings/agreements` 통합 테스트 필요

### Funding Brewery Info API

완료:

- `PATCH /api/fundings/drafts/:draftId/brewery-info` 필수값 검증을 프론트 요청 body 기준으로 맞췄습니다.
- camelCase와 snake_case 필드명을 모두 허용했습니다.
- 사업자등록번호와 전화번호는 하이픈 포함/미포함 모두 허용하도록 정규화했습니다.
- 숫자형 계좌번호도 문자열로 변환해 처리하도록 정리했습니다.
- `accountHolder`가 없으면 `representativeName`을 fallback으로 사용하게 했습니다.

변경 파일:

- `src/controllers/funding.controller.js`
- `database/20260522_funding_project_flow.sql`
- `docs/FUNDING_API_STATUS.md`

남은 작업:

- 실제 DB에 마이그레이션 적용 후 API 통합 테스트 필요
- 운영 전에는 요청자 권한과 draft 소유자 검증 필요

### Funding Documents

완료:

- `POST /api/fundings/drafts/:draftId/documents`에서 프론트 문서 타입을 받을 수 있게 했습니다.
- `idCard`, `businessLicense`, `salesPermit`, `alcoholPermit`, `manufacturingLicense`를 지원합니다.
- `alcoholPermit`과 `manufacturingLicense`를 같은 값으로 합치지 않고 구분하도록 했습니다.
- 문서 메타데이터 `mime_type`, `file_size` 저장 구조를 추가했습니다.

변경 파일:

- `src/controllers/funding.controller.js`
- `database/20260522_funding_project_flow.sql`

남은 작업:

- 현재 파일 URL은 placeholder입니다. 실제 S3 업로드 연결이 필요합니다.
- 필수 문서 조건은 실제 정책에 맞춰 한 번 더 확정해야 합니다.

### Funding DB Migration

완료:

- 펀딩 프로젝트 생성/수정/상세/후원 흐름에서 컨트롤러가 기대하는 테이블과 컬럼을 마이그레이션 파일로 정리했습니다.
- 추가된 파일: `database/20260522_funding_project_flow.sql`

포함 범위:

- `funding_drafts`
- `funding_documents`
- `funding_likes`
- `funding_questions`
- `funding_question_replies`
- `funding_question_likes`
- `funding_reviews`
- `funding_reports`
- `funding_shares`
- `brewery_log_likes`
- `brewery_log_comments`
- `brewery_log_comment_likes`
- 기존 `funding_projects`, `funding_support_options`, `orders`, `payments`, `brewery_logs` 보강 컬럼

주의:

- 저장소 기준 스키마와 현재 컨트롤러가 기대하는 DB 구조가 크게 달라서 마이그레이션 파일을 별도로 관리합니다.
- 2026-05-22에 `judam` DB에 마이그레이션을 적용했습니다.
- 단, `brewery_logs`는 owner가 `judam_admin`이라 `judam_jaewon` 계정으로는 해당 테이블 ALTER/INDEX 생성이 불가합니다.

### Funding API Implementation Status

확인 결과:

- 약관, 기본정보, 법적고시, 맛지표, 양조장 정보, 안내사항은 구현에 가까운 상태입니다.
- 일정, 프로젝트 계획, 문서 업로드, 제출, 목록/상세, 주문/결제, 찜, 양조일지, Q&A, 후기는 부분 구현 상태입니다.
- 공유/신고/문의 일부는 아직 mock 응답 성격이 남아 있습니다.
- 관리자 승인은 존재하지만 `recipeId = 3` 하드코딩이 있어 production-ready가 아닙니다.
- 2026-05-26 기준 펀딩 write API의 `req.user?.userId || 1` fallback은 제거했습니다.

상세 문서:

- `docs/FUNDING_API_STATUS.md`

### Toss Payment Status Review

확인한 엔드포인트:

- `POST /api/orders/:orderId/payment`
- `GET /api/orders/:orderId/payment`
- `PATCH /api/orders/:orderId/payment/complete`
- `POST /api/payments/toss/confirm`

현재 구현된 것:

- 주문 금액과 결제 요청 금액 일치 여부를 검사합니다.
- 결제 요청 시 `payments`에 `READY` 상태 결제 데이터를 생성합니다.
- 응답에 `paymentUrl`과 `checkoutUrl`을 내려줍니다.
- Toss confirm API에서 `paymentKey`, `orderId`, `amount` 필수값을 검사합니다.
- `TOSS_SECRET_KEY` 환경변수를 사용해 Toss `/v1/payments/confirm`을 호출합니다.
- `paymentKey`가 `test_`로 시작하면 로컬/Postman 테스트용 mock 승인 처리를 합니다.
- 승인 성공 시 트랜잭션 안에서 `payments`, `orders`, `funding_projects.current_amount`를 함께 갱신합니다.

확인된 한계:

- `POST /api/orders/:orderId/payment`의 `paymentUrl`은 아직 `https://payment.example.com/pay/:orderId` placeholder입니다.
- Expo 앱에서 열 실제 Toss checkout URL 생성은 아직 미완성입니다.
- `PATCH /api/orders/:orderId/payment/complete`는 Toss 승인 없이 결제 완료 처리와 펀딩 금액 증가를 수행하므로 운영에서는 막거나 테스트 전용으로 제한해야 합니다.
- `payment.controller.js`는 `next(error)`를 호출하지만 현재 앱에 명시적인 JSON 에러 핸들러가 없어 Toss 에러 응답 형식 정리가 필요합니다.
- `database/schema.sql`에는 `payments.payment_key`가 없고, 보강은 `database/20260522_funding_project_flow.sql`에 들어가 있습니다.
- 결제 요청의 `amount`는 현재 number 타입만 허용하므로 프론트가 문자열 금액을 보내면 400이 날 수 있습니다.

남은 작업:

- 실제 Toss 결제창으로 이동 가능한 checkout/payment URL 생성 방식 확정
- 성공/실패 redirect URL 정책 확정
- `PATCH /api/orders/:orderId/payment/complete` 운영 차단 또는 제거
- Toss confirm 에러를 JSON으로 내려주는 글로벌 에러 핸들러 추가
- DB 마이그레이션 적용 후 결제 요청부터 confirm까지 통합 테스트

### Judam DB Migration And Smoke Test

완료:

- 앞으로 이 프로젝트의 DB 작업은 `Judam/judam` DB만 기준으로 진행하기로 했습니다.
- `.env`는 `judam` DB를 가리키고 있었지만, 기존 셸 환경변수의 `smart_health_dog` 값이 우선 적용되는 문제가 있었습니다.
- `index.js`에서 `dotenv.config({ override: true })`를 사용하도록 수정해 `.env` 값이 우선되게 했습니다.
- SSM 포트포워딩 `localhost:5433 -> judam-db...:5432`를 통해 `judam` DB 접속을 확인했습니다.
- `database/20260522_funding_project_flow.sql`을 `judam` DB에 적용했습니다.
- 적용 후 주요 펀딩 테이블/컬럼을 `information_schema`로 확인했습니다.
- `PORT=3100 node index.js`로 서버를 띄워 실제 API 스모크 테스트를 진행했습니다.
- DB 기준 문서 `docs/DATABASE.md`를 추가했습니다.

검증:

- DB 접속 확인: `current_database() = judam`, `current_user = judam_jaewon`
- `GET /health` -> 200
- `POST /api/fundings/agreements` with 7 required terms true -> 200
- `PATCH /api/fundings/drafts/:draftId/brewery-info` -> 200, `progressRate = 85`
- `POST /api/fundings/agreements` with one required term false -> 400 `필수 약관에 모두 동의해야 합니다.`
- 테스트로 생성한 draft는 `DELETE /api/fundings/drafts/:draftId`로 삭제했고, DB 잔여 row 0건을 확인했습니다.
- 전체 JS 파일 `node --check` 통과

### Funding Project Creation Full Flow Check

완료:

- 실제 `judam` DB 기준으로 펀딩 프로젝트 생성 happy path를 끝까지 테스트했습니다.
- 테스트 순서:
  - `POST /api/fundings/agreements`
  - `PATCH /api/fundings/drafts/:draftId/basic-info`
  - `PATCH /api/fundings/drafts/:draftId/schedule`
  - `PATCH /api/fundings/drafts/:draftId/legal-info`
  - `PATCH /api/fundings/drafts/:draftId/taste-profile`
  - `PATCH /api/fundings/drafts/:draftId/plan`
  - `PATCH /api/fundings/drafts/:draftId/brewery-info`
  - `PATCH /api/fundings/drafts/:draftId/notices`
  - `POST /api/fundings/drafts/:draftId/documents` 5종
  - `POST /api/fundings/drafts/:draftId/submit`

검증 결과:

- 모든 생성 단계가 200 또는 201로 통과했습니다.
- 5개 필수 문서 업로드 후 `progressRate = 100`을 확인했습니다.
- 최종 제출에서 `fundingId`, `recipeId`가 생성되는 것을 확인했습니다.
- 테스트로 생성한 `draftId=11`, `fundingId=8`, `recipeId=60`, 문서 row는 검증 후 모두 삭제했고 잔여 row 0건을 확인했습니다.

결론:

- 프로젝트 생성 happy path는 동작 확인 완료입니다.
- 다만 production-ready 완료 상태는 아닙니다. 아래 항목은 남아 있습니다:
  - 요청자 인증 및 draft 소유자 검증
  - funding document 실제 S3 업로드 연결
  - `submitFundingDraft`와 관리자 승인 중 어느 단계에서 `funding_projects`를 만들지 정책 확정
  - 관리자 승인 로직의 `recipeId = 3` 하드코딩 제거
  - `brewery_logs` owner/admin 권한으로 누락 컬럼/index 적용

변경 파일:

- `index.js`
- `database/20260522_funding_project_flow.sql`
- `docs/DATABASE.md`
- `docs/FUNDING_API_STATUS.md`
- `docs/WORK_LOG.md`

주의:

- `brewery_logs` owner가 `judam_admin`이라 `video_url`, `updated_at`, `brewery_logs(funding_id)` index는 이번 계정으로 적용하지 못했습니다.
- `brewery_logs` owner/admin 권한으로 별도 적용이 필요합니다.

### Funding Creation Manage/Community Follow-up

완료:

- SSM 포트포워딩을 다시 열고 `judam` DB 접속을 재확인했습니다.
- `database/20260522_funding_followup.sql`을 추가하고 `judam` DB에 적용했습니다.
- `funding_drafts.funding_id`를 추가해 제출된 draft와 생성된 funding을 연결했습니다.
- 후기용 DB 필드 `mood`, `pairing`, `tags`, `record_visibility`, `updated_at`을 추가했습니다.
- 프론트 후기 폼에는 제목이 없으므로 `funding_reviews.title`의 `NOT NULL` 제약을 제거했습니다.
- 파일 업로드에서 S3 권한/설정이 없을 때 placeholder나 실패 대신 data URL fallback을 저장하도록 했습니다.
- 프로젝트 이미지 응답에서 대표 이미지 중복이 생기지 않도록 `thumbnailUrl`, `imageUrls`, `allImageUrls`를 정리했습니다.
- draft preview/detail에 프로젝트 계획, 영상 URL, 예산, 일정, 양조장/정산/사업자 정보, 안내사항, 문서 목록이 돌아오도록 보강했습니다.
- 관리자 승인 시 `draft.funding_id`가 있으면 새 funding을 또 만들지 않고 기존 funding을 `ONGOING`으로 갱신하도록 수정했습니다.
- 펀딩 통계 API `GET /api/fundings/stats`를 추가했습니다.
- Q&A 좋아요/취소 API를 라우트에 연결했습니다.
- 후기 수정 API `PATCH /api/fundings/:fundingId/reviews/:reviewId`를 추가했습니다.
- 공유/신고/후기/양조일지/Q&A 주요 흐름을 DB-backed로 검증했습니다.

검증:

- 실제 `judam` DB와 로컬 서버 `PORT=3100` 기준으로 통합 테스트를 완료했습니다.
- 테스트 흐름:
  - 7개 약관 동의
  - 기본정보/일정/법적고시/맛지표/프로젝트 계획/양조장 정보/파일/안내사항/5종 문서 저장
  - 양조장 정보 불러오기
  - draft preview
  - 최종 제출
  - 관리자 승인
  - 공개 상세 조회
  - 펀딩 찜
  - 펀딩 통계 및 정렬 조회
  - 양조일지 이미지 업로드와 댓글 2개 저장
  - Q&A 답변 2개 저장과 좋아요/취소
  - 공유 링크와 신고 저장
  - 제목 없는 후기 작성과 후기 수정
- 통합 테스트 결과 `draftId=20`, `fundingId=13`, `recipeId=65` 생성 후 모두 삭제했습니다.
- 테스트 데이터 잔여 row 0건을 확인했습니다.

아직 외부 연동이 필요한 항목:

- 휴대폰 본인 인증은 실제 SMS 발송/검증 제공사 연동이 필요합니다.
- 1원 계좌 인증은 오픈뱅킹/펌뱅킹/계좌 인증 제공사 연동과 계약이 필요합니다.
- 주소 검색은 보통 프론트에서 주소 검색 API를 붙이고, 백엔드는 선택된 주소/우편번호를 저장하는 구조가 필요합니다.
- 술BTI 추천순의 실제 매칭 %는 현재 백엔드에 점수 테이블/AI 결과가 없어 `matchRate`를 실제 계산하지 못합니다.

### Address Storage And Frontend Handoff

완료:

- 프론트가 다음/카카오 주소 검색에서 만든 `[우편번호] 주소` 문자열을 백엔드가 그대로 저장하는 방식으로 확정했습니다.
- `PATCH /api/fundings/drafts/:draftId/brewery-info`의 `businessAddress`는 `funding_drafts.business_address`에 그대로 저장됩니다.
- `POST /api/fundings/:fundingId/orders`의 `shippingAddress`는 `orders.shipping_address`에 그대로 저장됩니다.
- `shippingAddress`가 `[06236] 서울 강남구 테헤란로 152` 형식이고 `postalCode`가 생략되면 백엔드가 `06236`을 추출해 `orders.postal_code`에 저장하도록 보강했습니다.
- 후원 주문 주소 필드에 camelCase/snake_case alias를 추가했습니다.
- S3 권한 요청, 주소 저장 방식, 업로드 API, 17개 항목 검증 결과를 프론트 전달용 문서로 정리했습니다.

검증:

- 실제 `judam` DB 기준으로 사업장 소재지 저장/불러오기와 후원 주문 배송지 저장을 확인했습니다.
- 검증 주소: `[06236] 서울 강남구 테헤란로 152`
- 확인 결과:
  - `businessAddress` 저장/응답/불러오기 정상
  - `shippingAddress` 저장/응답 정상
  - `postalCode = 06236` 자동 추출/저장 정상
- 테스트 데이터는 검증 후 삭제했습니다.

문서:

- `docs/FRONTEND_HANDOFF_FUNDING.md`

### Funding Interaction Follow-up

완료:

- 프론트 재점검 피드백 기준으로 누락/애매한 상호작용 API를 보강했습니다.
- `database/20260524_funding_interactions.sql`을 추가하고 `judam` DB에 적용했습니다.
- Q&A 답글 좋아요/취소 API를 추가했습니다.
- Q&A 목록 응답의 `replies`에 `writerId`, `writerNickname`, `likeCount`, `liked`를 추가했습니다.
- 양조일지 답글 좋아요 전용 URL alias를 추가했습니다.
- 기존 `brewery_log_comment_likes` 구조를 댓글/답글 공통 좋아요 저장소로 유지했습니다.
- 후기 수정 API에서 multipart 이미지 추가와 `deleteImageUrls` 제거를 지원하도록 수정했습니다.
- 후기 삭제 API를 추가했습니다.
- 펀딩 목록/상세에 SulBTI 매칭 점수 alias를 추가했습니다:
  - `sulbtiMatchScore`
  - `matchScore`
  - `tasteMatchScore`
  - `matchRate`
- `sort=RECOMMENDED`가 SulBTI 매칭 점수 기준으로 정렬되도록 수정했습니다.

검증:

- 실제 `judam` DB와 로컬 서버 `PORT=3100` 기준으로 API 통합 검증을 완료했습니다.
- 검증 항목:
  - Q&A 답글 좋아요/취소와 목록 재조회 시 `liked`, `likeCount` 유지
  - 양조일지 댓글 좋아요
  - 양조일지 답글 좋아요 전용 URL
  - 양조일지 댓글 목록에서 댓글/답글 `liked`, `likeCount` 유지
  - 후기 multipart 수정, 신규 이미지 추가, `deleteImageUrls` 제거
  - 후기 삭제
  - SulBTI 매칭 점수 4개 alias 반환
- 테스트로 생성한 `fundingId=17` 관련 데이터는 모두 삭제했습니다.
- 테스트 데이터 잔여 row 0건을 확인했습니다.

### Funding Frontend Confirmation Follow-up

완료:

- 프론트 확인 요청 기준으로 후기 응답의 작성자 식별값을 보강했습니다.
- 후기 목록, 상세, 작성, 수정, 삭제 응답에 아래 alias를 함께 내려주도록 통일했습니다:
  - `writerId`
  - `writer_id`
  - `userId`
  - `user_id`
- 후기 상세 API를 추가했습니다:
  - `GET /api/fundings/:fundingId/reviews/:reviewId`
- 후기 목록/상세/작성/수정 응답에 `content`와 같은 값의 `detailReview`, `recordVisibility`와 같은 값의 `showRecord` alias를 추가했습니다.
- 후기 multipart 수정에서 `tags`와 `deleteImageUrls` JSON 문자열 배열 파싱을 유지했습니다.
- multipart/form-data에서 `recordVisibility=false` 또는 `showRecord=false`가 문자열로 와도 false로 처리되도록 boolean 파싱을 보강했습니다.
- 양조일지 댓글/답글 좋아요와 Q&A 답글 좋아요 응답의 `liked`, `likeCount` 반환을 재확인했습니다.
- SulBTI 매칭 점수 alias와 계산 불가 시 `null` 반환을 재확인했습니다.

검증:

- `node --check src/controllers/funding.controller.js`
- `node --check src/routes/fundingRoutes.js`
- 실제 `judam` DB 기준으로 임시 funding/review/Q&A/양조일지/SulBTI 데이터를 생성해 통합 검증했습니다.
- 검증 항목:
  - 후기 목록/상세/작성/수정/삭제 응답의 writer alias
  - multipart `tags`, `deleteImageUrls` JSON 문자열 배열 처리
  - Q&A 답글 좋아요 응답의 `liked`, `likeCount`
  - 양조일지 댓글/답글 좋아요 응답의 `liked`, `likeCount`
  - 펀딩 목록/상세 SulBTI match alias
- 검증용 `fundingId=18` 관련 데이터는 모두 삭제했고, 테스트 row 0건을 확인했습니다.

### Funding Review Comments And Brewery Update Follow-up

완료:

- 후기 상세 댓글 DB 저장용 마이그레이션을 추가하고 Judam DB에 적용했습니다:
  - `database/20260524_funding_review_comments.sql`
- 후기 댓글 목록/작성 API를 추가했습니다:
  - `GET /api/fundings/:fundingId/reviews/:reviewId/comments`
  - `POST /api/fundings/:fundingId/reviews/:reviewId/comments`
- 후기 댓글 좋아요/취소 API를 추가했습니다:
  - `POST /api/fundings/:fundingId/reviews/:reviewId/comments/:commentId/likes`
  - `DELETE /api/fundings/:fundingId/reviews/:reviewId/comments/:commentId/likes`
- 후기 댓글 응답에 `commentId`, `writerId`, `writerNickname`, `content`, `likeCount`, `liked`, `createdAt`, `updatedAt`을 포함했습니다.
- 승인된 양조장 정보 수정 API를 추가했습니다:
  - `PATCH /api/breweries/applications/me`
- 양조장 인증 상태 조회는 기존 `GET /api/breweries/applications/me`를 유지하며, 프론트는 `data.status`로 PENDING/REJECTED/APPROVED UI를 붙이면 됩니다.

검증:

- Judam DB에 `20260524_funding_review_comments.sql` 적용 완료
- 후기 댓글 작성/목록/좋아요/취소 통합 테스트 완료
- 승인된 양조장 정보 수정 통합 테스트 완료
- 검증용 `fundingId=20`, `reviewId=7`, `applicationId=6` 관련 데이터는 모두 삭제했습니다.
- 테스트 row 0건을 확인했습니다.

### Funding Creation Manage Final Recheck

완료:

- 관리하기 화면용 draft 조회 API를 추가했습니다:
  - `GET /api/fundings/drafts/by-funding/:fundingId`
- 제출 직후 프론트가 실수로 `draftId`를 상세/찜 API에 넘겨도 연결된 `fundingId`로 해석하도록 보강했습니다.
- `GET /api/fundings/:fundingId`와 `POST/DELETE /api/fundings/:fundingId/likes`가 draft id fallback을 지원합니다.
- 대표 이미지 1장이 2장처럼 보이지 않도록 이미지 URL 정규화/중복 제거를 강화했습니다.
- 진행률이 100% 이후 프로젝트 계획/일정/고시/맛지표/안내사항 재저장 시 낮아지지 않도록 `GREATEST(progress_rate, n)` 기준으로 수정했습니다.
- 일정 저장 시 `platformFeeRate`, `platformFeeAmount`, `shippingFee`를 draft DB에 저장하고 다시 내려주도록 보강했습니다.
- 펀딩 통계 응답에 천만원 단위 필드를 추가했습니다:
  - `totalRaisedTenMillion`
  - `totalRaisedTenMillionUnit`
- 양조일지 댓글 작성/목록 응답에 `writerId`, `writerNickname`, `likeCount`, `liked`, `replies`를 포함하도록 보강했습니다.
- 후기 자체 좋아요/취소 API를 추가했습니다:
  - `POST /api/fundings/:fundingId/reviews/:reviewId/likes`
  - `DELETE /api/fundings/:fundingId/reviews/:reviewId/likes`
- 후기 목록/상세 응답에 후기 자체 `likeCount`, `liked`를 포함했습니다.
- 신고 저장은 한국어 사유 5종 기준으로 DB 저장됨을 재검증했습니다.

검증:

- Judam DB 기준 전체 플로우 통합 검증을 완료했습니다.
- 검증 항목:
  - 양조장 정보 탭 불러오기
  - draft preview/manage load
  - 프로젝트 계획 영상/예산/일정 로드
  - 양조장 은행/계좌/대표자/업태/종목/파일 로드
  - 필수 서류 5종 로드
  - 제출 후 상세 조회
  - 상세/찜의 draftId fallback
  - 대표 이미지 중복 제거
  - 진행률 100% 유지
  - 천만원 단위 통계
  - 양조일지 댓글 DB 저장/조회
  - 신고 DB 저장
  - 후기 mood/pairing/tags/recordVisibility 로드
  - 후기 좋아요/댓글/댓글 좋아요
- 검증용 `draftId=29`, `fundingId=22` 관련 데이터는 모두 삭제했습니다.
- 테스트 row 0건을 확인했습니다.

### Funding Cleanup, Image Arrays, And Bank Verification

완료:

- Judam DB에서 제목이 정확히 `test`인 펀딩 데이터를 삭제했습니다.
  - `funding_projects`: 3건 삭제
  - 연결된 `funding_drafts`: 2건 삭제
- 펀딩 상세/관리 이미지 응답 정규화를 보강했습니다.
  - `imageUrls`는 항상 배열입니다.
  - `allImageUrls`는 항상 배열이며 대표 이미지 포함, 중복 제거 기준입니다.
  - legacy DB 값이 단일 문자열 또는 JSON 문자열로 들어와도 배열로 정규화합니다.
- 계좌 인증 요청/확인용 마이그레이션을 추가하고 Judam DB에 적용했습니다.
  - `database/20260525_funding_bank_account_verifications.sql`
- 계좌 인증 API를 추가했습니다.
  - `POST /api/fundings/bank-account/verification`
  - `POST /api/fundings/bank-account/verification/confirm`
- `PATCH /api/fundings/drafts/:draftId/brewery-info`에서 `bankVerificationToken`이 있으면 검증 후 `accountVerified=true`로 저장하도록 보강했습니다.
- 기존 `POST /api/fundings/drafts/:draftId/account-verification`도 즉시 인증 완료가 아니라 확인된 `bankVerificationToken`이 있어야 통과하도록 수정했습니다.

검증:

- `funding_projects.title = 'test'` 잔여 0건 확인
- `funding_drafts.title = 'test'` 잔여 0건 확인
- `funding_bank_account_verifications` 테이블 생성 확인
- 계좌 인증 요청/확인/토큰 기반 draft 계좌 인증 스모크 테스트 완료
- 스모크 테스트 row 삭제 후 잔여 0건 확인
- `node --check src/controllers/funding.controller.js` 통과
- `node --check src/routes/fundingRoutes.js` 통과
- `git diff --check` 통과

### Funding Writer Identity Fields

완료:

- Q&A 질문/답글 응답에 실제 작성자 식별 필드를 추가했습니다.
  - `writerId`, `writer_id`, `userId`, `user_id`
  - `writerNickname`
  - `writerRole`, `role`
  - `isBrewery`, `writerIsBrewery`
- 양조일지 댓글/답글 작성/목록 응답에 같은 작성자 식별 필드를 추가했습니다.
- 일반 유저 작성자는 `role=USER`, `isBrewery=false`로 내려갑니다.
- 양조장 계정 작성자는 `role=BREWERY`, `isBrewery=true`로 내려갑니다.
- 작성자 닉네임은 프로젝트 양조장명이 아니라 `users.nickname` 기준입니다.

검증:

- Judam DB 기준 일반 `USER` 계정으로 Q&A 질문/답글 생성 후 목록 재조회 스모크 테스트를 완료했습니다.
- Judam DB 기준 일반 `USER` 계정으로 양조일지 댓글/답글 생성 후 목록 재조회 스모크 테스트를 완료했습니다.
- 일반 유저 응답이 `writerNickname=테스트소비자`, `writerRole=USER`, `isBrewery=false`로 내려오는 것을 확인했습니다.
- 스모크 테스트 데이터 삭제 후 잔여 0건을 확인했습니다.

### Funding Flow Recheck And Auth Fallback Removal

완료:

- 펀딩 라우트에 optional auth middleware를 추가했습니다.
  - Authorization 토큰이 있으면 `req.user`를 세팅합니다.
  - Authorization이 없으면 공개 GET은 통과합니다.
  - 잘못된 Authorization 토큰은 401을 반환합니다.
- 댓글/답글/좋아요/후기/주문 등 사용자 저장이 필요한 API에서 `userId=1` fallback을 제거했습니다.
- 인증이 필요한 write API는 `req.user.userId`가 없으면 401을 반환하도록 정리했습니다.
- 비로그인 공개 조회에서는 `liked=false`가 내려가도록 확인했습니다.
- 후기 댓글 작성자 응답에도 실제 작성자 정보를 추가했습니다.
  - `writerId`, `userId`, `writerNickname`, `writerProfileImage`, `writerRole`, `role`, `isBrewery`, `writerIsBrewery`
- 댓글/답글 작성자 닉네임 fallback을 `users.nickname -> "사용자"`로 고정했습니다.
  - 프로젝트 양조장명, `funding_projects.brewery_user_id`, `brewery_auth.brewery_name` 기준 fallback은 사용하지 않습니다.
- 기존에 이미 잘못된 `user_id`로 저장된 과거 댓글/답글은 저장된 `user_id` 기준으로 표시되므로, 실제 작성자 매핑 없이는 자동 보정하지 않습니다.
- 공개 상세 API가 linked draft 값을 fallback으로 사용하도록 보강했습니다.
  - `category`
  - `thumbnailUrl`
  - `imageUrls`
  - `tasteProfile`
  - `legalInfo`
  - `plan`
  - `breweryInfo`
  - `notices`
  - `documents`

검증:

- Judam DB 기준 임시 linked `funding_project + funding_draft + documents 5종` 데이터를 생성해 `GET /api/fundings/drafts/by-funding/:fundingId`를 검증했습니다.
- 관리하기 응답에서 `basicInfo`, `plan`, `breweryInfo`, `documents` 5종이 내려오는 것을 확인했습니다.
- `basicInfo.allImageUrls`가 대표 이미지를 포함하고 중복 제거된 배열로 내려오는 것을 확인했습니다.
- 공개 상세 응답에서 등록값 기반 `category`, `mainIngredient`, `legalInfo`, `tasteProfile`, `plan`, `breweryInfo`, `notices`, `documents`가 내려오는 것을 확인했습니다.
- 일반 USER 계정으로 Q&A, 양조일지, 후기 댓글 작성/조회 시 실제 작성자 닉네임/role/profile 필드가 내려오는 것을 확인했습니다.
- 신고 `reason/content`가 `funding_reports`에 저장되는 것을 확인했습니다.
- 스모크 테스트 데이터 삭제 후 잔여 0건을 확인했습니다.
- `node --check src/controllers/funding.controller.js`, `node --check src/routes/fundingRoutes.js`, `node --check src/middlewares/optionalAuthMiddleware.js` 통과
- `git diff --check` 통과

### Brewery Dashboard Profile And Notifications

완료:

- 양조장 대시보드 프로필 API를 추가했습니다.
  - `GET /api/breweries/me/profile`
  - `PATCH /api/breweries/me/profile`
  - `PATCH /api/breweries/me/profile/image`
- 양조장 대시보드 알림 API를 추가했습니다.
  - `GET /api/breweries/me/dashboard/basic-info`
  - `GET /api/breweries/me/dashboard/funding-summary`
  - `GET /api/breweries/me/dashboard/fundings`
  - `GET /api/breweries/me/dashboard/notifications`
  - `PATCH /api/notifications/:notificationId/read`
  - `PATCH /api/notifications/read-all`
- `brewery_profiles` 테이블을 추가해 대시보드 프로필 표시/수정용 값을 DB에 저장하도록 했습니다.
- `brewery_dashboard_notifications` 테이블을 추가해 알림과 읽음 상태를 DB에 저장하도록 했습니다.
- `brewery_auth`는 owner 권한 문제로 ALTER하지 않고, 인증 원본/read-only 값 조회용으로 유지했습니다.
- 사업자등록번호와 전화번호는 조회 전용으로 유지했습니다.
- 프로필 수정의 `email`은 로그인 계정 이메일이 아니라 양조장 연락용 이메일인 `brewery_profiles.contact_email`에 저장합니다.
- 프로필 이미지 multipart 업로드를 추가하고, 업로드 결과 URL을 `brewery_profiles.profile_image_url`에 저장하도록 했습니다.
  - `image`, `profileImage`, `file` 필드명을 허용합니다.
  - `jpg`, `jpeg`, `png`, `webp` 파일을 최대 5MB까지 허용합니다.
  - S3 실패 시 `FILE_UPLOAD_STRICT_S3=true`가 아니면 data URL fallback을 저장합니다.
- 내 펀딩 현황 요약 API를 추가했습니다.
  - `funding_projects`와 `orders`를 실제 DB 기준으로 집계합니다.
  - 추가 마이그레이션은 필요하지 않습니다.
- 내 펀딩 현황 목록 API를 추가했습니다.
  - `status=active|completed`, `page`, `size` 쿼리를 지원합니다.
  - 로그인한 양조장 계정의 `funding_projects.brewery_user_id` 기준으로만 조회합니다.
  - 카드 표시용 `fundingId`, `title`, `breweryName`, `thumbnailUrl`, `currentAmount`, `targetAmount`, `achievementRate`, `status`, `remainingDays`, `endDate`를 반환합니다.

문서:

- `docs/BREWERY_DASHBOARD_API.md`
- `database/20260528_brewery_dashboard_profile_notifications.sql`

검증:

- Judam DB에 `database/20260528_brewery_dashboard_profile_notifications.sql` 적용 완료
- `brewery_profiles`, `brewery_dashboard_notifications` 테이블 생성 확인
- 2026-05-28 DB 재연결 후 `judam` / `judam_jaewon` 기준 양조장 대시보드 필수 테이블/컬럼 누락 0건 확인
- `brewery_profiles`, `brewery_dashboard_notifications`의 FK/UNIQUE/CHECK 제약조건과 조회용 인덱스 확인
- 임시 양조장 계정/인증/프로필/알림 row로 DB-backed 스모크 테스트 완료 후 테스트 데이터 삭제
- 현재 `brewery_profiles`, `brewery_dashboard_notifications` row count는 0건입니다. 프로필 row는 최초 프로필 수정/이미지 업로드 시 생성되고, 알림 row는 알림 생성 로직이 넣을 때 생성됩니다.
- `node --check src/services/brewery.service.js` 통과
- `node --check src/controllers/brewery.controller.js` 통과
- `node --check src/controllers/notification.controller.js` 통과
- `node --check src/routes/brewery.routes.js`, `src/routes/notification.routes.js`, `src/routes/index.js` 통과

### Brewery Dashboard Notification Auto Creation

완료:

- 양조장 대시보드 알림 자동 생성용 서비스를 추가했습니다.
  - `createBreweryDashboardNotification`
  - `createFundingCreatedNotification`
  - `createFundingProgressNotification`
  - `createFundingProgressNotificationsForReachedThresholds`
  - `createFundingEndedNotification`
  - `createFundingSuccessNotification`
  - `createRecipePopularNotification`
- 관리자 펀딩 승인 시 `FUNDING_CREATED` 알림을 생성하도록 연결했습니다.
- 레시피에서 펀딩 전환 시 `FUNDING_CREATED` 알림을 생성하도록 연결했습니다.
- Toss 결제 승인 및 결제 완료 처리 후 달성률 30/50/80% 구간 알림을 생성하도록 연결했습니다.
- 레시피 관심 등록 후 관심 수가 30개 이상이면 모든 승인 양조장 계정에 `RECIPE_POPULAR` 알림을 생성하도록 연결했습니다.
- 펀딩 종료/성공 판정 API에서 호출할 수 있도록 `FUNDING_ENDED`, `FUNDING_SUCCESS` 생성 함수를 분리했습니다.
- 알림 목록 응답에 `fundingId`, `recipeId`, `progressThreshold`, `metadata`를 추가했습니다.
- 중복 방지를 위해 알림 이벤트 컬럼/인덱스 마이그레이션을 추가했습니다.

문서/마이그레이션:

- `src/services/breweryDashboardNotification.service.js`
- `database/20260530_brewery_dashboard_notification_events.sql`
- `docs/BREWERY_DASHBOARD_API.md`
- `docs/DATABASE.md`

검증/주의:

- 로컬 `localhost:5433` SSM 터널이 닫혀 있고 현재 IAM 사용자에 `ssm:StartSession` 권한이 없어 Judam DB 적용은 이 턴에서 완료하지 못했습니다.
- 터널/권한 복구 후 `database/20260530_brewery_dashboard_notification_events.sql`을 Judam DB에 적용해야 서버에서 새 알림 응답 필드와 자동 생성 로직이 정상 동작합니다.

### Brewery Log Video URL

완료:

- 양조일지 생성/수정 API에서 `videoUrl`, `video_url`, `url` 문자열 필드를 받을 수 있게 했습니다.
- `videoUrl`은 이미지 업로드와 분리해서 `brewery_logs.video_url`에 저장하도록 했습니다.
- `PATCH /api/fundings/:fundingId/brewery-logs/:breweryLogId`에서 `videoUrl`을 빈 문자열로 보내면 기존 영상 URL이 삭제되도록 했습니다.
- 양조일지 목록/생성/수정 응답에 `videoUrl`과 `updatedAt`을 포함하도록 했습니다.
- 양조일지 수정에서 `deleteImageUrls` JSON 문자열 배열을 받아 기존 이미지 배열에서 제거하도록 했습니다.
- DB 컬럼이 아직 적용되지 않은 환경에서도 조회 API는 `videoUrl: null`로 동작하고, 저장/수정 요청은 필요한 마이그레이션 파일명을 포함해 에러를 반환하도록 방어 처리했습니다.

문서/마이그레이션:

- `database/20260530_brewery_log_video_url.sql`
- `docs/FRONTEND_HANDOFF_FUNDING.md`
- `docs/FUNDING_API_STATUS.md`
- `docs/DATABASE.md`

검증/주의:

- 로컬 `localhost:5433` SSM 터널이 닫혀 있고 현재 IAM 사용자에 `ssm:StartSession` 권한이 없어 Judam DB 적용은 이 턴에서 완료하지 못했습니다.
- `brewery_logs`는 기존 기록상 `judam_admin` 소유 테이블이라 마이그레이션 적용에는 owner/admin 권한이 필요할 수 있습니다.

### Brewery Dashboard Funding Delivery

완료:

- 종료된 펀딩 카드의 배송 관리 모달용 API를 추가했습니다.
  - `GET /api/breweries/me/dashboard/fundings/:fundingId/delivery`
  - `PATCH /api/breweries/me/dashboard/fundings/:fundingId/delivery`
- 로그인한 양조장 계정이 만든 펀딩인지 확인하도록 했습니다.
- 존재하지 않는 `fundingId`는 404, 다른 양조장 펀딩은 403을 반환합니다.
- 배송 저장/수정은 대시보드 목록의 `completed` 필터와 같은 종료 펀딩 조건에서만 허용합니다.
- `courier`, `trackingNumber` 필수 검증을 추가했습니다.
- `funding_deliveries` 테이블 마이그레이션을 추가했습니다.
  - `funding_id` unique 기준으로 배송 정보 1건만 저장합니다.
  - PATCH는 insert-or-update 방식입니다.

문서/마이그레이션:

- `database/20260530_funding_deliveries.sql`
- `docs/BREWERY_DASHBOARD_API.md`
- `docs/DATABASE.md`

검증/주의:

- 로컬 `localhost:5433` SSM 터널이 닫혀 있고 현재 IAM 사용자에 `ssm:StartSession` 권한이 없어 Judam DB 적용은 이 턴에서 완료하지 못했습니다.
- 서버/Judam DB에서 테스트하려면 `database/20260530_funding_deliveries.sql` 적용이 필요합니다.

### Brewery Dashboard Funding Summary Alignment

완료:

- `GET /api/breweries/me/dashboard/funding-summary`의 active 집계 기준을 `GET /api/breweries/me/dashboard/fundings?status=active` 목록 필터와 동일하게 맞췄습니다.
- `totalFundingCount`는 대시보드 탭에 표시되는 active + completed 펀딩 수로 계산하도록 정리했습니다.
- `totalParticipantCount`는 해당 양조장의 active + completed 펀딩에 대한 `orders.order_status = 'PAID'` 고유 참여자 수로 계산합니다.
- 심사 중/작성 중처럼 active/completed 탭에 포함하지 않는 상태는 `totalFundingCount`에서도 제외합니다.

검증/주의:

- 로컬 `localhost:5433` SSM 터널이 닫혀 있어 실제 Judam DB 응답 3종 스모크 테스트는 이 턴에서 진행하지 못했습니다.
- `node --check src/services/brewery.service.js`와 `git diff --check`로 코드 검증했습니다.

### Funding Settlement Policy

완료:

- 마감일이 지난 펀딩을 KST 기준으로 자동 정산하는 서비스를 추가했습니다.
- 서버 시작 시 매일 00:05 KST에 정산이 실행되도록 스케줄러를 연결했습니다.
- 정산 대상은 `ACTIVE` 상태이고 `end_date < KST 오늘`인 펀딩입니다.
- 기존 승인 데이터 호환을 위해 legacy `ONGOING` 상태도 정산 대상에 포함했습니다.
- `current_amount >= goal_amount`이면 `SUCCESS`, 미달이면 `FAILED`로 업데이트합니다.
- 관리자 수동 정산 API를 추가했습니다.
  - `POST /api/admin/fundings/settle-expired`
- 관리자 펀딩 승인 시 생성/갱신되는 공개 펀딩 상태를 프론트 정책에 맞춰 `ACTIVE`로 변경했습니다.
- 주문 생성 API에서 `ACTIVE`/legacy `ONGOING`이 아니거나 KST 기준 마감일이 지난 펀딩은 `"종료된 펀딩에는 후원할 수 없습니다."`로 차단합니다.
- 정산 시 성공 펀딩에는 `FUNDING_SUCCESS`, 실패 펀딩에는 `FUNDING_ENDED` 알림만 생성하도록 연결했습니다.

문서:

- `docs/BREWERY_DASHBOARD_API.md`

검증:

- `node --check src/services/fundingSettlement.service.js`
- `node --check src/jobs/fundingSettlementScheduler.js`
- `node --check src/controllers/admin.controller.js`
- `node --check src/controllers/funding.controller.js`
- `node --check index.js`
- `git diff --check`

### Brewery Dashboard Funding List Alignment

완료:

- `GET /api/breweries/me/dashboard/fundings?status=active` 조건을 프론트 정책에 맞춰 정리했습니다.
  - 로그인한 양조장 계정의 `funding_projects.brewery_user_id`
  - `status = ACTIVE`
  - `end_date >= KST 오늘`
  - 기존 데이터 호환을 위해 legacy `ONGOING`은 active에 포함하되 응답 `status`는 `ACTIVE`로 내려갑니다.
- `completed` 목록은 `SUCCESS`, `FAILED`, `CANCELED` 및 제작/배송/완료 운영 상태만 포함하도록 정리했습니다.
- `ACTIVE`이지만 `end_date`가 지난 펀딩은 목록 API에서 임의로 completed 처리하지 않고, 00:05 KST 정산 후 `SUCCESS`/`FAILED`가 되면 completed에 포함되도록 맞췄습니다.
- `funding-summary`는 active/completed 목록과 같은 조건을 그대로 사용하므로 `activeFundingCount = active totalElements`, `totalFundingCount = active + completed totalElements` 관계가 유지됩니다.
- 목록 응답에 원본 분기용 `status`와 표시용 `statusLabel`을 함께 내려주도록 변경했습니다.
- DB에서 `FUNDING_CREATED` 알림의 `funding_id`와 목록 조건을 비교했습니다.
  - `항공 막걸리` / `fundingId=32` / `userId=4` / `ACTIVE` / `2026-06-28` / active 조건 통과
  - `알림 테스트` / `fundingId=36` / `userId=4` / `ACTIVE` / `2026-06-29` / active 조건 통과
- 서비스 직접 호출로 `userId=4` active 목록 `content`와 `data`에 `fundingId=32`, `fundingId=36`이 포함되는 것을 확인했습니다.
- 빈 목록이어도 `totalPages`는 최소 `1`로 내려가도록 보정했습니다.
- `userId=18`도 summary와 active 목록을 비교해 `activeFundingCount=3`, active 목록 `totalElements=3` 일치를 확인했습니다.

문서:

- `docs/BREWERY_DASHBOARD_API.md`

검증:

- `node --check src/services/brewery.service.js`
- `git diff --check`

### Brewery Dashboard Settlement Notification Types

완료:

- `FUNDING_ENDED`를 펀딩 실패 알림 의미로 정리했습니다.
  - title: `펀딩이 실패했습니다.`
  - content: `'{펀딩명}' 펀딩이 목표 금액을 달성하지 못해 실패했습니다.`
  - eventKey: `funding:{fundingId}:failed`
  - metadata.result: `FAILED`
- `FUNDING_SUCCESS` 생성 시점을 자동/수동 정산으로 성공 확정된 시점으로 유지하고 문구를 정리했습니다.
  - content: `'{펀딩명}' 펀딩이 목표 금액을 달성해 성공했습니다.`
  - metadata.result: `SUCCESS`
- 자동 정산 cron과 수동 정산 API 모두 성공/실패 결과에 맞는 알림만 생성하도록 분기했습니다.
- 새 알림 타입 `SETTLEMENT_COMPLETED`를 추가했습니다.
- 관리자 정산 완료 알림 API를 추가했습니다.
  - `POST /api/admin/fundings/:fundingId/settlement-completed`
- `SETTLEMENT_COMPLETED`는 성공 확정 펀딩에만 생성할 수 있고, `funding:{fundingId}:settlement_completed` eventKey로 중복 생성이 방지됩니다.
- `brewery_dashboard_notifications` check constraint에 `SETTLEMENT_COMPLETED`를 추가하는 마이그레이션을 작성하고 연결된 Judam DB에 적용했습니다.

문서/마이그레이션:

- `database/20260602_brewery_dashboard_settlement_notification_type.sql`
- `docs/BREWERY_DASHBOARD_API.md`

검증:

- `node --check src/services/breweryDashboardNotification.service.js`
- `node --check src/services/fundingSettlement.service.js`
- `node --check src/controllers/admin.controller.js`
- `node --check src/routes/adminRoutes.js`
- 연결된 Judam DB에서 `SETTLEMENT_COMPLETED` insert/rollback 테스트 통과
- `git diff --check`

## Backlog

- 전체 펀딩 API 통합 테스트 작성 또는 Postman/curl 시나리오 정리
- `brewery_logs` owner/admin 권한으로 누락 컬럼/index 적용
- old draft fallback의 `recipeId = 3` 하드코딩 제거
- S3 bucket/IAM 권한 정리와 운영 업로드 정책 확정
- inquiry mock 응답 DB-backed로 전환
- Toss checkout URL 생성 로직 완성
- Toss confirm 에러 응답 JSON 핸들러 추가
- 운영 서버 재시작/배포 후 auth fallback 제거 로직 반영 확인
- `database/schema.sql`과 마이그레이션 파일의 기준 정리
