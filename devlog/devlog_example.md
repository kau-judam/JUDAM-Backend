# 일일 보고서

* 날짜 : 4월 28일
* 작성자 : 장요한(by Claude Code)

---

### 작업 1 — `POST /api/recipes` 엔드포인트 구현 흐름 파악

백엔드 API는 보통 3개 계층으로 역할이 나뉨. 오늘 이 구조를 그대로 따라 만듦.

```
요청(클라이언트)
    ↓
[Route]       어느 URL로 들어오면 누가 처리할지 연결
    ↓
[Controller]  요청을 받아 유효성 검사 후 Service 호출, 응답 반환
    ↓
[Service]     실제 비즈니스 로직 처리 (AI 필터링 호출 등)
```

---

### 작업 2 — Request / Response DTO 구조 이해

**Request (클라이언트가 보내야 하는 데이터)**

| 필드 | 설명 | 필수 |
|---|---|---|
| `title` | 레시피 이름 | 필수 |
| `content` | 제조 과정 상세 | 필수 |
| `abv_range` | 도수 범위 (예: "6~8%") | 필수 |
| `main_ingredient` | 주요 원료 | 필수 |
| `target_flavor` | 원하는 맛 방향 | 필수 |
| `concept` | 레시피 컨셉 | 필수 |
| `summary` | 한 줄 요약 | 필수 |
| `image_url` | 이미지 URL | 선택 |

**Response (서버가 돌려주는 데이터)**

`recipe_id`, `title`, `author_type`, `status`, `is_fundable`, `interest_count`, `image_url`, `created_at`을 포함한 JSON을 201로 응답.

---

### 작업 3 — `POST /api/recipes` 완성

실제로 만들어진 파일 3개.

- `src/routes/recipeRoutes.js` — `POST /api/recipes` 경로를 `authMiddleware`(로그인 검증)와 연결
- `src/controllers/recipeController.js` — 필수 필드 7개 누락 시 400 에러 반환, 정상이면 Service 호출 후 201 응답
- `src/services/recipeService.js` — JWT에서 `role` 꺼내 `author_type` 자동 설정, 초기값(`is_fundable: false`, `interest_count: 0`, `status: PUBLISHED`) 설정

---

### 작업 4 — AI 법률 필터링 인터페이스 정의

- `src/utils/aiFilterInterface.js` 파일 신규 생성
- `checkRecipeLegalFilter(recipeData)` 함수 정의 — 현재는 항상 통과 반환
- 추후 AI팀 협의 후 함수 내부만 교체하면 실제 AI 필터링 연동 가능한 구조로 설계
