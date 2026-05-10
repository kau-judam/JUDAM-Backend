# 일일 보고서

* 날짜 : 5월 10일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : feature/recipe-delete

---

### 작업 1 — 레시피 상태 전이 검증 (WBS #8)

**이 작업이 하는 일**: 레시피 상태가 정해진 순서대로만 바뀌는지, 잘못된 경로는 제대로 막히는지 확인한다.

**레시피 상태 흐름**

```
PUBLISHED → FUNDING_READY → FUNDING_IN_PROGRESS → COMPLETED
```

| 상태 | 의미 |
|------|------|
| `PUBLISHED` | 레시피 작성 직후 초기 상태 |
| `FUNDING_READY` | 관심 수 100개 이상 도달 시 자동 전환 |
| `FUNDING_IN_PROGRESS` | 양조장이 펀딩 전환 API 호출 시 수동 전환 |
| `COMPLETED` | 펀딩 완료 (현재 미구현) |

**검증한 케이스**

| 케이스 | 방법 | 결과 |
|--------|------|------|
| 순서 건너뛰기 (PUBLISHED → FUNDING_IN_PROGRESS) | Thunder Client API 요청 | 400 정상 반환 |
| 역방향 전이 (FUNDING_READY → PUBLISHED) | 코드 레벨 확인 | 역방향 API 자체 없음 — 설계상 불가 |
| 일반 유저가 펀딩 전환 시도 | Thunder Client API 요청 | 403 정상 반환 |
| 정상 흐름 (PUBLISHED → FUNDING_READY → FUNDING_IN_PROGRESS) | Thunder Client API 요청 | 각 단계 200/201 정상 반환 |
| 이미 진행 중인 레시피에 재전환 시도 | Thunder Client API 요청 | 400 정상 반환 |

> 테스트 환경: 로컬 서버 (`localhost:3000`) + AWS RDS (SSM 터널 경유)  
> 임계값을 100 → 1로 임시 낮춰 테스트 후 원복함

---

### 작업 2 — `DELETE /api/recipes/:recipeId` 레시피 삭제 API 구현

**이 API가 하는 일**: 로그인한 사용자가 본인이 작성한 레시피를 삭제한다.

**검증 조건 3가지** (순서대로 확인)

1. 레시피 존재 여부 — 없으면 404
2. 본인 작성 여부 — 다른 사람 레시피면 403
3. 상태 확인 — `PUBLISHED` 또는 `FUNDING_READY`만 삭제 가능. `FUNDING_IN_PROGRESS` / `COMPLETED` 상태면 400

**이유**: 펀딩이 시작된 이후에는 양조장과 계약 관계가 생기므로 작성자라도 임의로 삭제하면 안 된다.

**응답 예시**

```json
// 성공 (200)
{ "status": 200, "message": "레시피가 삭제되었습니다." }

// 펀딩 진행 중 삭제 시도 (400)
{ "status": 400, "message": "펀딩이 진행 중이거나 완료된 레시피는 삭제할 수 없습니다." }

// 타인 레시피 삭제 시도 (403)
{ "status": 403, "message": "본인이 작성한 레시피만 삭제할 수 있습니다." }
```

**테스트 결과**

| 케이스 | 결과 |
|--------|------|
| PUBLISHED 상태 레시피 삭제 (본인) | 200 정상 삭제 |
| FUNDING_READY 상태 레시피 삭제 (본인) | 200 정상 삭제 |
| FUNDING_IN_PROGRESS 상태 레시피 삭제 시도 | 400 정상 반환 |
| COMPLETED 상태 레시피 삭제 시도 | 400 정상 반환 |
| 타인 레시피 삭제 시도 | 403 정상 반환 |

**수정된 파일**: `recipeService.js`, `recipeController.js`, `recipeRoutes.js`
