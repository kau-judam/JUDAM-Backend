# 일일 보고서

* 날짜 : 6월 10일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : fix/mypage-canviewdelivery-success

---

### 배경 — 14주차 마이페이지 7개 GET API 실서버(AWS) 1:1 재검증

14주차 마이페이지 명세 7개 GET API(요약·참여펀딩 목록·주문/배송 상세·활동 관심/댓글/Q&A·후기 불러오기)를 **실 운영 서버(`43.202.24.223:3000`)** 에 통째로 호출해 요청/응답 바디를 명세와 1:1 대조. 데이터 보유 계정(`tmdqls1015@naver.com` uid=1)으로 전 엔드포인트 200 응답·필드 일치 확인. 그 과정에서 `canViewDelivery`가 프론트 요구를 충족하지 못함을 발견 → 수정.

---

### 발견 — `canViewDelivery`가 운송장에 묶여 SUCCESS여도 버튼이 안 뜸

- **현 구현**: `canViewDelivery = (fundingStatus==='SUCCESS' && 운송장번호 존재)`.
- **FE 요청서(6.2)**: "성공한 경우에만 배송 내역 확인 버튼 표시"를 2회 명시. "운송장 번호"라는 조건은 **없음**. 게다가 `canViewDelivery`와 `hasTrackingNumber`(운송장 존재 여부)를 **별개 필드로 따로** 요청 → canViewDelivery를 운송장에 묶지 말라는 의도.
- **실측 영향**: 운영 DB에 운송장 데이터가 하나도 없어, SUCCESS인 funding 3조차 `canViewDelivery=false`. 즉 "성공이면 버튼"이라는 FE 의도가 현재 충족 안 됨.

---

### 수정 — `canViewDelivery`를 SUCCESS 단독 기준으로 변경

`mypage.service.js`의 `getParticipatedFundings` 한 줄 변경(운송장 조건 제거):

```diff
- const canViewDelivery = fundingStatus === 'SUCCESS' && hasTrackingNumber;
+ // FE 정책: 펀딩 성공(SUCCESS)이면 배송 내역 확인 버튼 노출(참여 펀딩은 항상 주문 존재).
+ // 운송장 유무는 hasTrackingNumber로 별도 표시하므로 canViewDelivery 조건에서 제외.
+ const canViewDelivery = fundingStatus === 'SUCCESS';
```

- 참여 펀딩 목록은 정의상 모두 본인 주문이 있는 항목 → "주문 정보 존재"는 항상 충족. 운송장 유무는 `hasTrackingNumber`로 따로 내려가므로 버튼 노출 판정에서 제외.
- 주문/배송 상세(`orders/{orderId}`)는 `canViewDelivery`가 없어 영향 없음. 운송장 없어도 결제액·수령인·주소는 정상 응답(배송 필드만 `null`).

---

### 검증 — 로컬 서버(fix 브랜치) participated 통째 호출

로컬 서버(`npm start`, SSM 터널) + uid=1 토큰으로 `GET /api/mypage/fundings/participated` 전체 호출, 200 응답.

| fundingId | fundingStatus | canViewDelivery | hasTrackingNumber |
|---|---|---|---|
| 31 | REJECTED | false | false |
| 30 | CANCELED | false | false |
| 3 | **SUCCESS** | **true**(수정 전 false) | false |
| 1 | ACTIVE | false | false |

→ 운송장이 없어도 SUCCESS면 `true`, 비-SUCCESS는 모두 `false`. 의도대로 동작.

---

### 명세 동기화 (1:1 검증으로 발견한 차이 반영)

실서버 응답이 FE 요구를 충족하는 항목은 **명세서를 실응답에 맞춰** 갱신(코드 변경 없음):

- 참여 펀딩 목록.md — `canViewDelivery` 설명 3곳을 "SUCCESS면 true(운송장 무관)"로 수정
- 요약.md — `sulbti`는 `null`이 아니라 `{hasResult, type, btiCode, title, description, summary, characterName, alcoholLabel, tags}` 객체임을 반영(결과 없으면 `hasResult:false`+일부 필드 null), success 메시지 실값("마이페이지 메인 요약 조회 성공")으로 정정
- 활동 댓글 목록.md — `updatedAt`을 `String | null`로(수정 이력 없으면 null)
- 5개 명세 — 일시 필드가 ISO 8601 **UTC(밀리초·`Z`)** 형식임을 표기(예: `2026-05-19T21:16:49.894Z`)

---

### 참고사항

- **권한 확인**: `canViewDelivery`/`deliveryStatus` 코드는 git blame상 전부 `장요한`(커밋 `c3c5903b`) 본인 코드 — 타인 가드 아님, 안전하게 수정.
- **미배포**: 이 fix는 `fix/mypage-canviewdelivery-success`(dev 분기) 로컬 브랜치에만 있음. 운영(AWS)은 PR 머지+배포 전까지 옛 로직(`&& 운송장`) 유지.
- **메시지 정규화 미들웨어 유입**: dev 최신화 중 `responseMessageNormalizer.js`가 새로 들어옴. 응답 success 메시지를 정규화하면 명세에 맞춘 message가 배포 후 또 바뀔 수 있어, 배포 시점에 재확인 필요.
- 명세 파일은 백엔드 repo 밖(`00.DefaultContext`) 문서라 이 브랜치 커밋에는 코드 1파일만 포함됨.
