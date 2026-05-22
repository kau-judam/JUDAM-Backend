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
- 여러 API가 `req.user?.userId || 1` fallback을 사용하고 있어 인증/권한 정리가 필요합니다.

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

## Backlog

- 전체 펀딩 API 통합 테스트 작성 또는 Postman/curl 시나리오 정리
- `brewery_logs` owner/admin 권한으로 누락 컬럼/index 적용
- `submitFundingDraft`와 관리자 승인 중 어느 단계에서 공개 `funding_projects`를 생성할지 정책 확정
- `recipeId = 3` 하드코딩 제거
- funding documents 실제 S3 업로드 연결
- share/report/inquiry mock 응답 DB-backed로 전환
- Toss checkout URL 생성 로직 완성
- Toss confirm 에러 응답 JSON 핸들러 추가
- Q&A 좋아요 API 추가
- 후기 수정/삭제/좋아요/댓글 API 검토
- `req.user?.userId || 1` 테스트 fallback 제거 및 인증 미들웨어 적용
- `database/schema.sql`과 마이그레이션 파일의 기준 정리
