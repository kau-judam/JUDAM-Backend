# 일일 보고서

* 날짜 : 6월 9일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : feature/archive-funding-dedup

---

### 배경 — 프론트 추가요청: 펀딩 술 아카이브 "한 펀딩당 1회"

`feature/archive-supplement`로 참여 펀딩 목록·후기 불러오기를 붙인 뒤, 프론트에서 펀딩 술 기록 관련 보완 요청(`99.추가_작업_일정_문서/프론트엔드_추가_요청사항.md`)이 들어왔다. 핵심은 **한 펀딩은 한 번만 아카이브로 기록**되게 하는 것:

1. 참여 펀딩 목록에서 이미 기록한 펀딩 제외
2. 그 아카이브 기록을 삭제하면 다시 목록에 표시
3. 작성 API에서 같은 펀딩 중복 작성 차단

전부 **기존 API 2개 수정**(신규/삭제 없음). 중복 기준은 `archive_type='FUNDING' AND user_id=본인 AND funding_id=해당 AND deleted_at IS NULL`. DB 마이그레이션 없음(쓰는 컬럼 모두 운영 DB에 존재).

---

### 작업 1 — 참여 펀딩 목록에서 기록한 펀딩 제외 (요청 1·2)

`getParticipatedFundings`(`mypage.service.js`)의 참여 펀딩 추출 서브쿼리에 제외 필터 추가:

```sql
AND NOT EXISTS (
  SELECT 1 FROM user_archives ua
  WHERE ua.user_id = $1 AND ua.archive_type = 'FUNDING'
    AND ua.funding_id = o.funding_id AND ua.deleted_at IS NULL
)
```

- **삭제 시 재노출(요청 2)은 추가 코드 없이 자동 충족**: 아카이브 삭제가 이미 soft delete(`deleted_at` 세팅)라, 기록을 삭제하면 `deleted_at IS NULL` 조건에서 빠져 해당 펀딩이 목록에 다시 포함된다.

---

### 작업 2 — 작성 시 같은 펀딩 중복 차단 (요청 3)

`createMyArchive`(`mypage.service.js`) 트랜잭션 안, INSERT 직전에 선검사 추가:

- `archive_type='FUNDING'`이고 `funding_id`가 있을 때만, 동일 `user_id`+`funding_id`의 `deleted_at IS NULL` 기록을 조회 → 있으면 `400 "이미 기록한 펀딩입니다."`로 차단(트랜잭션 ROLLBACK).
- **공용 서비스에 넣어** `POST /archives/with-images`(프론트 사용)와 `POST /archives`(JSON) **두 작성 경로 모두** 자동 보호(우회 불가).
- 일반 술(`NORMAL`)은 대상 아님 — `funding_id`가 없고, 같은 술을 여러 날 기록하는 게 정상이라 막지 않는다.
- 삭제(soft delete) 후 같은 펀딩 재작성은 허용(`deleted_at IS NULL` 조건이 자동 처리).

---

### 작업 3 — 로컬 E2E 검증 (운영 DB, 임시 레코드 생성·정리)

로컬 서버 + SSM 터널(운영 DB) + `user@judam.test`(uid=19, 참여펀딩 1·31·34). 임시 펀딩 아카이브 1건만 만들고 검증 후 하드 삭제로 베이스라인 원복(테스트 흔적 0).

| 단계 | 기대 | 결과 |
|---|---|---|
| 참여목록(베이스라인) | 1, 31, 34 | 200, 3건 |
| 펀딩 1 작성 | 201 | 201 |
| 작성 후 참여목록 | 1 제외 → 31, 34 | 2건 ✅ |
| 펀딩 1 재작성 | 400 "이미 기록한 펀딩입니다." | 400 ✅ |
| 아카이브 삭제 | 200 | 200 |
| 삭제 후 참여목록 | 1 재노출 → 1, 31, 34 | 3건 ✅ |
| 삭제 후 재작성 | 201 허용 | 201 ✅ |

응답 필드·타입·상태코드·메시지 모두 명세서와 일치 확인.

---

### 참고사항

- 변경은 `mypage.service.js` 한 파일(약 28줄). 신규 파일·DB 마이그레이션 없음. 쓰는 컬럼(`user_archives.archive_type/user_id/funding_id/deleted_at`)은 운영 DB에 모두 존재(`[5.30]DB스키마.md` 확인).
- (설계) 중복 방어는 앱 레벨 선검사(SELECT→INSERT)다. 동시 더블탭 같은 경합은 이론상 남으며, 완전 차단은 부분 유니크 인덱스(`UNIQUE(user_id, funding_id) WHERE archive_type='FUNDING' AND deleted_at IS NULL`)가 필요하지만 "마이그레이션 없이" 방침에 따라 보류. 프론트가 목록에서 기록한 펀딩을 숨기므로 실사용 위험은 낮음.
- (명세 보완) 작성 성공 응답에 기존 동작인 `aiTasteUpdate` 객체가 별점 등 AI 갱신 대상일 때 따라온다(본 기능 무관). 명세서(`[아카이브]아카이브 작성.md`)에 조건부 포함으로 보완함.
- (일반 술) 일반 술 중복을 막지 않는 건 의도된 동작 — 펀딩 술과 달리 동일 기준(funding_id)이 없고, 같은 술을 다른 날 시음 기록으로 여러 번 남기는 게 정상.
