# 일일 보고서

* 날짜 : 5월 8일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : feature/recipe-funding

---

### 작업 1 — `feature/recipe-funding` 브랜치 생성

`dev` 브랜치에서 분기하여 `feature/recipe-funding` 브랜치를 생성했다.

---

### 작업 2 — `POST /api/recipes/:recipeId/funding` 양조장 펀딩 전환 API 구현

**이 API가 하는 일**: 양조장이 `FUNDING_READY` 상태인 레시피를 실제 펀딩 프로젝트로 전환한다. 성공 시 `RECIPES.status`가 `FUNDING_IN_PROGRESS`로 바뀌고, `FUNDING_PROJECTS` 테이블에 새 레코드가 생성된다.

**요청 바디**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| title | String | ✅ | 펀딩 프로젝트 제목 |
| description | String | ❌ | 펀딩 상세 설명 |
| goal_amount | Int | ✅ | 목표 금액 (원) |
| start_date | String | ✅ | 펀딩 시작일 (YYYY-MM-DD) |
| end_date | String | ✅ | 펀딩 마감일 (YYYY-MM-DD) |

**성공 응답 (201 Created)**

```json
{
  "status": 201,
  "message": "펀딩 프로젝트가 등록되었습니다.",
  "funding": {
    "funding_id": 1,
    "recipe_id": 42,
    "title": "달콤한 복숭아 막걸리 — 첫 번째 펀딩",
    "goal_amount": 5000000,
    "current_amount": 0,
    "start_date": "2026-05-20",
    "end_date": "2026-06-20",
    "funding_status": "ACTIVE",
    "recipe_status": "FUNDING_IN_PROGRESS"
  }
}
```

**구현된 검증 로직**

| 조건 | 응답 |
|------|------|
| BREWERY가 아닌 사용자 호출 | 403 — `breweryMiddleware` 처리 |
| 필수 필드 누락 | 400 — "필수 항목이 누락되었습니다." |
| 레시피가 존재하지 않음 | 404 — "해당 레시피를 찾을 수 없습니다." |
| 레시피가 이미 FUNDING_IN_PROGRESS | 400 — "이미 펀딩이 진행중인 레시피입니다." |
| 레시피 status가 FUNDING_READY가 아님 | 400 — "펀딩 전환 가능 상태(FUNDING_READY)인 레시피만 전환할 수 있습니다." |

**트랜잭션 처리**: `FUNDING_PROJECTS` INSERT와 `RECIPES` UPDATE를 하나의 트랜잭션으로 묶어, 둘 중 하나라도 실패하면 모두 롤백된다.

**변경 파일**

- `src/services/recipeService.js` — `convertRecipeToFunding` 함수 추가
- `src/controllers/recipeController.js` — `postRecipeFunding` 핸들러 추가
- `src/routes/recipeRoutes.js` — `POST /:recipeId/funding` 라우트 추가 (authMiddleware + breweryMiddleware)

---

### 작업 3 — 테스트 완료

| 케이스 | 기대 | 결과 |
|--------|------|------|
| 양조장 토큰 + FUNDING_READY 레시피 | 201 | ✅ |
| 소비자 토큰 | 403 | ✅ |
| 이미 FUNDING_IN_PROGRESS인 레시피 재호출 | 400 | ✅ |
| 필수 필드 누락 | 400 | ✅ |
| 존재하지 않는 recipeId | 404 | ✅ |
