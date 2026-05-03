# 일일 보고서

* 날짜 : 4월 29일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : feature/recipe-crud

---

### 작업 1 — `GET /api/recipes` 레시피 목록 조회 구현

**이 API가 하는 일**: 등록된 레시피 전체를 목록으로 반환한다. 로그인하지 않아도 누구나 볼 수 있다.

**쿼리 파라미터 3가지 지원**

| 파라미터 | 설명 | 기본값 |
|---|---|---|
| `sort` | `newest`(최신순) / `popular`(관심 수 많은 순) | newest |
| `status` | 특정 상태만 필터 (`PUBLISHED`, `FUNDING_READY` 등) / `ALL`이면 전체 | ALL |
| `page` / `size` | 페이지 번호(0부터), 한 페이지당 항목 수 | 0 / 20 |

**응답 구조** — 목록은 카드에 보여줄 필드만 포함 (상세 내용은 제외)

```json
{
  "recipes": [
    {
      "recipe_id": 1,
      "title": "달콤한 복숭아 막걸리",
      "summary": "복숭아향 가득한 달콤한 저도수 막걸리",
      "main_ingredient": "쌀, 복숭아",
      "author_type": "CONSUMER",
      "status": "FUNDING_READY",
      "is_fundable": true,
      "interest_count": 105,
      "image_url": null,
      "created_at": "2026-04-27T10:30:00.000Z"
    }
  ],
  "totalElements": 2,
  "totalPages": 1,
  "currentPage": 0
}
```

**비로그인 허용**: `authMiddleware`를 붙이지 않고 라우터에 바로 연결.

---

### 작업 2 — `GET /api/recipes/:recipeId` 레시피 상세 조회 구현

**이 API가 하는 일**: 특정 레시피 하나의 모든 정보를 반환한다. 목록에는 없던 `content`(제조 과정), `abv_range`(도수), `ai_sub_ingredient` 등 상세 필드가 포함된다.

**응답 구조**

```json
{
  "recipe": {
    "recipe_id": 1,
    "title": "달콤한 복숭아 막걸리",
    "content": "복숭아 과즙을 활용한 저도수 막걸리...",
    "abv_range": "6~8%",
    "main_ingredient": "쌀, 복숭아",
    "ai_sub_ingredient": null,
    "target_flavor": "달콤하고 과일향이 풍부하게",
    "concept": "여름에 시원하게 즐기는 과일 막걸리",
    "summary": "복숭아향 가득한 달콤한 저도수 막걸리",
    "author_type": "CONSUMER",
    "status": "FUNDING_READY",
    "is_fundable": true,
    "interest_count": 105,
    "image_url": null,
    "created_at": "2026-04-27T10:30:00.000Z",
    "updated_at": "2026-04-27T10:30:00.000Z"
  }
}
```

**존재하지 않는 ID 요청 시** → 404 반환

```json
{ "status": 404, "message": "해당 레시피를 찾을 수 없습니다." }
```

**`ai_sub_ingredient` 필드**: AI가 추천하는 부재료인데, 아직 AI팀과 연동 전이라 지금은 `null`로 반환. 나중에 AI 연동이 되면 값이 채워질 예정.

---

### 작업 3 — 로컬 테스트 완료

서버를 실행해서 아래 4가지 케이스 직접 확인.

| 테스트 | 결과 |
|---|---|
| `GET /api/recipes` (전체 목록) | 200, 레시피 2개 반환 |
| `GET /api/recipes?sort=popular&status=PUBLISHED` (필터) | 200, PUBLISHED 레시피 1개만 반환 |
| `GET /api/recipes/1` (상세 조회) | 200, 전체 필드 포함 반환 |
| `GET /api/recipes/999` (없는 ID) | 404 반환 |

커밋 완료: `feat: GET /recipes 목록 조회 및 GET /recipes/:recipeId 상세 조회 구현`

---

### 참고사항

- 현재 `recipeService.js`의 `MOCK_RECIPES` 배열은 실제 DB가 연결되지 않은 상태에서 API 동작 확인을 위해 임시로 하드코딩한 가짜 데이터다. 
  - AWS RDS가 연결되고 실제 테이블이 구축되면 이 배열 전체를 삭제하고, `getRecipes` / `getRecipeById` 함수 내부의 데이터 조회 로직을 실제 DB 쿼리로 교체해야 한다.