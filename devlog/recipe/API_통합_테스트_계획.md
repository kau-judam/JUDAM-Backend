# 레시피 API 통합 테스트 계획 — 8~10주차

> **서버**: `http://localhost:3000`
> **500 에러 케이스는 테스트 제외**
> **체크박스 상태**: `[ ]` 미실행 / `[x]` 통과 / `[F]` 실패 (실패 시 옆에 실제 응답 메모)

---

## 사전 준비

### 토큰 발급

```
POST http://localhost:3000/auth/login
Content-Type: application/json
```

| 계정 | 요청 바디 | 용도 |
|------|-----------|------|
| 소비자 | `{"email":"test-consumer@judam.com"}` | 일반 기능 테스트 |
| 양조장 | `{"email":"test-brewery@judam.com"}` | 양조장 전용 기능, 권한 오류 테스트 |

→ 응답의 `token` 값을 `Authorization: Bearer {token}` 헤더에 사용

### 플레이스홀더 안내

| 기호 | 설명 |
|------|------|
| `{recipeId}` | 테스트 중 TC-01 또는 기존 레시피에서 얻은 실제 ID |
| `{commentId}` | TC-21에서 생성한 댓글의 실제 ID |
| `{breweryRecipeId}` | TC-42에서 양조장이 생성한 레시피 ID |
| `{fundingReadyRecipeId}` | status=FUNDING_READY 인 레시피 ID (DB에서 확인 필요) |

### 테스트 실행 시 주의사항

- 관심 등록(TC-10) → 관심 해제(TC-14) 순서 준수
- 댓글 좋아요 등록(TC-34) → 좋아요 취소(TC-38) 순서 준수
- 댓글 삭제(TC-33)는 댓글 관련 다른 테스트 완료 후 마지막에 실행
- 레시피 삭제(TC-71)는 해당 레시피 관련 모든 테스트 완료 후 마지막에 실행
- 펀딩 전환(TC-61)에 필요한 FUNDING_READY 레시피: interest_count ≥ 100 조건 → DB에서 기존 레시피 ID 확인 후 사용

---

## 진행 현황

| 총 케이스 | 통과 | 실패 | 미실행 |
|-----------|------|------|--------|
| 71 | 71 | 0 | 0 |

> TC-02b: AI 미연동으로 실행 불가 (별도 카운트)

---

## 8주차

---

### [08-01] 레시피 작성 — `POST /api/recipes`

> `Content-Type: multipart/form-data` | 이미지(`image` 필드) 생략 시 `image_url = null`

- [x] **TC-01** 성공 (201) — 소비자 토큰 + 이미지 없이 정상 바디
  - 바디: `title="[5.11 통합 API 테스트] 테스트 막걸리"` / `content="[5.11 통합 API 테스트] 테스트용 레시피"` / `abv_range="6~8%"` / `main_ingredient="쌀"` / `target_flavor="달콤"` / `concept="테스트"` / `summary="[5.11 통합 API 테스트] 테스트 막걸리 한 줄 요약"`
  - 기대: `status:201` / `message:"레시피가 등록되었습니다."` / `recipe.author_type:"USER"` / `recipe.status:"PUBLISHED"` / `recipe.is_fundable:false` / `recipe.interest_count:0` / `recipe.image_url:null`

- [x] **TC-02** 필수항목 누락 (400) — `title` 필드 제거한 바디 전송
  - 기대: `status:400` / `message:"필수 항목이 누락되었습니다."`

- [ ] **TC-02b** ~~AI 법률 필터링 차단 (400)~~ — **현재 실행 불가** (AI팀 미연동, 항상 통과 처리 중)
  - 연동 후 기대: `status:400` / `message:"등록할 수 없는 내용이 포함되어 있습니다. 레시피 내용을 다시 확인해 주세요."`

- [x] **TC-03** 인증 실패 (401) — Authorization 헤더 없이 요청
  - 기대: `status:401` / `message:"유효하지 않거나 만료된 토큰입니다."`

---

### [08-02] 레시피 목록 조회 — `GET /api/recipes`

> 비로그인 가능 | 쿼리 파라미터 없으면 `sort=newest`, `status=ALL` 기본 적용

- [x] **TC-04** 성공 (200) — 토큰 없이, 파라미터 없이
  - 기대: `status:200` / `recipes: Array` / `totalElements: Number` / `totalPages: Number` / `currentPage:0`

- [x] **TC-05** 성공 (200) — `GET /api/recipes?sort=popular`
  - 기대: `status:200` / 목록이 `interest_count` 내림차순으로 반환됨

- [x] **TC-06** 성공 (200) — `GET /api/recipes?status=FUNDING_READY`
  - 기대: `status:200` / `recipes` 배열 내 모든 항목의 `status:"FUNDING_READY"`

---

### [08-03] 레시피 상세 조회 — `GET /api/recipes/{recipeId}`

> 비로그인 가능

- [x] **TC-07** 성공 (200) — 존재하는 `{recipeId}`, 토큰 없이
  - 기대: `status:200` / `recipe.recipe_id` 존재 / `recipe.content` 존재 / `recipe.is_interested:false`

- [x] **TC-08** 성공 (200) — 존재하는 `{recipeId}`, 소비자 토큰 포함
  - 기대: `status:200` / `recipe.is_interested` 값이 실제 관심 등록 여부 반영 (관심 등록 전이면 `false`)

- [x] **TC-09** 레시피 없음 (404) — recipeId = `9999999`
  - 기대: `status:404` / `message:"해당 레시피를 찾을 수 없습니다."`

---

### [08-04] 레시피 관심 등록 — `POST /api/recipes/{recipeId}/interests`

- [x] **TC-10** 성공 (200) — 소비자 토큰 + 아직 관심 등록 안 한 `{recipeId}`
  - 기대: `status:200` / `message:"관심 등록 완료"` / `data.recipe_id:{recipeId}` / `data.interest_count` (이전보다 +1)

- [x] **TC-11** 중복 등록 (400) — TC-10 직후 동일 recipeId에 재요청
  - 기대: `status:400` / `message:"이미 관심 등록한 레시피입니다."`

- [x] **TC-12** 인증 실패 (401) — Authorization 헤더 없이 요청
  - 기대: `status:401` / `message:"유효하지 않거나 만료된 토큰입니다."`

- [x] **TC-13** 레시피 없음 (404) — recipeId = `9999999`
  - 기대: `status:404` / `message:"해당 레시피를 찾을 수 없습니다."`

---

### [08-05] 레시피 관심 해제 — `DELETE /api/recipes/{recipeId}/interests`

- [x] **TC-14** 성공 (200) — TC-10에서 관심 등록한 `{recipeId}` 해제
  - 기대: `status:200` / `message:"관심 해제 완료"` / `data.interest_count` (TC-10 이전 값으로 복원)

- [x] **TC-15** 관심 등록 내역 없음 (400) — TC-14 직후 동일 recipeId에 재요청
  - 기대: `status:400` / `message:"관심 등록 내역이 없습니다."`

- [x] **TC-16** 인증 실패 (401) — Authorization 헤더 없이 요청
  - 기대: `status:401` / `message:"유효하지 않거나 만료된 토큰입니다."`

- [x] **TC-17** 레시피 없음 (404) — recipeId = `9999999`
  - 기대: `status:404` / `message:"해당 레시피를 찾을 수 없습니다."`

---

## 9주차

---

### [09-01] 레시피 댓글 목록 조회 — `GET /api/recipes/{recipeId}/comments`

> 비로그인 가능 | 루트 댓글만 반환 (대댓글 제외)

- [x] **TC-18** 성공 (200) — 토큰 없이
  - 기대: `status:200` / `comments: Array` / 배열 내 모든 항목 `is_liked:false` / `is_mine:false`

- [x] **TC-19** 성공 (200) — 소비자 토큰 포함 (본인 댓글이 있는 경우)
  - 기대: `status:200` / 본인이 작성한 댓글의 `is_mine:true` 반영

- [x] **TC-20** 레시피 없음 (404) — recipeId = `9999999`
  - 기대: `status:404` / `message:"해당 레시피를 찾을 수 없습니다."`

---

### [09-02] 레시피 댓글 작성 — `POST /api/recipes/{recipeId}/comments`

- [x] **TC-21** 성공 (201) — 소비자 토큰 + `{"content":"[5.11 통합 API 테스트] 테스트 댓글입니다."}`
  - 기대: `status:201` / `message:"댓글이 작성되었습니다."` / `comment.content:"[5.11 통합 API 테스트] 테스트 댓글입니다."` / `comment.like_count:0`

- [x] **TC-22** content 없음 (400) — `{"content":""}`
  - 기대: `status:400` / `message:"댓글 내용을 입력해 주세요."`

- [x] **TC-23** 인증 실패 (401) — Authorization 헤더 없이 요청
  - 기대: `status:401` / `message:"유효하지 않거나 만료된 토큰입니다."`

- [x] **TC-24** 레시피 없음 (404) — recipeId = `9999999`
  - 기대: `status:404` / `message:"해당 레시피를 찾을 수 없습니다."`

---

### [09-03] 레시피 댓글 수정 — `PUT /api/recipes/{recipeId}/comments/{commentId}`

> `{commentId}` = TC-21에서 생성된 댓글 ID

- [x] **TC-25** 성공 (200) — 소비자 토큰(본인) + `{"content":"[5.11 통합 API 테스트] 수정된 댓글입니다."}`
  - 기대: `status:200` / `message:"댓글이 수정되었습니다."` / `comment.content:"[5.11 통합 API 테스트] 수정된 댓글입니다."` / `comment.updated_at` 존재

- [x] **TC-26** content 없음 (400) — `{"content":""}`
  - 기대: `status:400` / `message:"댓글 내용을 입력해 주세요."`

- [x] **TC-27** 인증 실패 (401) — Authorization 헤더 없이 요청
  - 기대: `status:401` / `message:"유효하지 않거나 만료된 토큰입니다."`

- [x] **TC-28** 타인 댓글 수정 (403) — 양조장 토큰으로 소비자 댓글(`{commentId}`) 수정 시도
  - 기대: `status:403` / `message:"본인이 작성한 댓글만 수정할 수 있습니다."`

- [x] **TC-29** 댓글 없음 (404) — commentId = `9999999`
  - 기대: `status:404` / `message:"해당 댓글을 찾을 수 없습니다."`

---

### [09-04] 레시피 댓글 삭제 — `DELETE /api/recipes/{recipeId}/comments/{commentId}`

> 실패 케이스 먼저 → 성공(TC-33)은 마지막에 실행 (이후 테스트에서 이 댓글 ID 필요)

- [x] **TC-30** 인증 실패 (401) — Authorization 헤더 없이 요청
  - 기대: `status:401` / `message:"유효하지 않거나 만료된 토큰입니다."`

- [x] **TC-31** 타인 댓글 삭제 (403) — 양조장 토큰으로 소비자 댓글(`{commentId}`) 삭제 시도
  - 기대: `status:403` / `message:"본인이 작성한 댓글만 삭제할 수 있습니다."`

- [x] **TC-32** 댓글 없음 (404) — commentId = `9999999`
  - 기대: `status:404` / `message:"해당 댓글을 찾을 수 없습니다."`

- [x] **TC-33** 성공 (200) — 소비자 토큰(본인)으로 TC-21 댓글 삭제 ← 대댓글/좋아요 테스트 완료 후 실행
  - 기대: `status:200` / `message:"댓글이 삭제되었습니다."`

---

### [09-05] 레시피 댓글 좋아요 등록 — `POST /api/recipes/{recipeId}/comments/{commentId}/likes`

> TC-33(댓글 삭제) 이전에 실행

- [x] **TC-34** 성공 (200) — 소비자 토큰 + 좋아요 등록 안 한 `{commentId}`
  - 기대: `status:200` / `message:"좋아요 등록 완료"` / `data.comment_id:{commentId}` / `data.like_count` (+1)

- [x] **TC-35** 중복 좋아요 (400) — TC-34 직후 동일 commentId에 재요청
  - 기대: `status:400` / `message:"이미 좋아요한 댓글입니다."`

- [x] **TC-36** 인증 실패 (401) — Authorization 헤더 없이 요청
  - 기대: `status:401` / `message:"유효하지 않거나 만료된 토큰입니다."`

- [x] **TC-37** 댓글 없음 (404) — commentId = `9999999`
  - 기대: `status:404` / `message:"해당 댓글을 찾을 수 없습니다."`

---

### [09-06] 레시피 댓글 좋아요 취소 — `DELETE /api/recipes/{recipeId}/comments/{commentId}/likes`

- [x] **TC-38** 성공 (200) — TC-34에서 좋아요 등록한 `{commentId}` 취소
  - 기대: `status:200` / `message:"좋아요 취소 완료"` / `data.like_count` (TC-34 이전 값으로 복원)

- [x] **TC-39** 좋아요 내역 없음 (400) — TC-38 직후 동일 commentId에 재요청
  - 기대: `status:400` / `message:"좋아요를 누르지 않은 댓글입니다."`

- [x] **TC-40** 인증 실패 (401) — Authorization 헤더 없이 요청
  - 기대: `status:401` / `message:"유효하지 않거나 만료된 토큰입니다."`

- [x] **TC-41** 댓글 없음 (404) — commentId = `9999999`
  - 기대: `status:404` / `message:"해당 댓글을 찾을 수 없습니다."`

---

### [09-07] 양조장 레시피 등록 — `POST /api/recipes/brewery`

> `Content-Type: application/json` | 양조장 토큰 필요

- [x] **TC-42** 성공 (201) — 양조장 토큰 + 정상 바디
  - 바디: `{"title":"[5.11 통합 API 테스트] 테스트 청주","content":"[5.11 통합 API 테스트] 테스트용 청주 레시피","abv_range":"13~15%","main_ingredient":"쌀","target_flavor":"향긋하고 산뜻","concept":"테스트 청주","summary":"[5.11 통합 API 테스트] 테스트 청주 한 줄 요약"}`
  - 기대: `status:201` / `message:"레시피가 등록되었습니다."` / `recipe.author_type:"BREWERY"` / `recipe.status:"PUBLISHED"` / `recipe.is_fundable:false` / `recipe.interest_count:0`

- [x] **TC-43** 필수항목 누락 (400) — `title` 필드 제거한 바디 전송
  - 기대: `status:400` / `message:"필수 항목이 누락되었습니다."`

- [x] **TC-44** 인증 실패 (401) — Authorization 헤더 없이 요청
  - 기대: `status:401` / `message:"유효하지 않거나 만료된 토큰입니다."`

- [x] **TC-45** 권한 없음 (403) — 소비자 토큰으로 요청
  - 기대: `status:403` / `message:"양조장 계정만 사용할 수 있는 기능입니다."`

---

### [09-08] 양조장 소비자 레시피 확인 — `GET /api/recipes/brewery`

> 양조장 토큰 필요 | `author_type=USER` 레시피만 반환 | 기본 정렬: interest_count 내림차순

- [x] **TC-46** 성공 (200) — 양조장 토큰, 파라미터 없이
  - 기대: `status:200` / `recipes` 배열 내 모든 항목의 `author_type:"USER"`

- [x] **TC-47** 성공 (200) — 양조장 토큰 + `?status=FUNDING_READY`
  - 기대: `status:200` / 반환된 레시피의 `status` 모두 `"FUNDING_READY"`

- [x] **TC-48** 인증 실패 (401) — Authorization 헤더 없이 요청
  - 기대: `status:401` / `message:"유효하지 않거나 만료된 토큰입니다."`

- [x] **TC-49** 권한 없음 (403) — 소비자 토큰으로 요청
  - 기대: `status:403` / `message:"양조장 계정만 사용할 수 있는 기능입니다."`

---

### [09-09] 마이페이지 내 레시피 목록 — `GET /api/users/me/recipes`

- [x] **TC-50** 성공 (200) — 소비자 토큰
  - 기대: `status:200` / `recipes: Array` / TC-01에서 작성한 레시피가 목록에 포함 / `totalElements: Number`

- [x] **TC-51** 인증 실패 (401) — Authorization 헤더 없이 요청
  - 기대: `status:401` / `message:"유효하지 않거나 만료된 토큰입니다."`

---

### [09-10] 마이페이지 관심 레시피 목록 — `GET /api/users/me/interests/recipes`

> TC-10(관심 등록) 이후 TC-14(관심 해제) 사이, 또는 별도 레시피에 관심 등록 후 테스트

- [x] **TC-52** 성공 (200) — 소비자 토큰
  - 기대: `status:200` / `recipes: Array` / 각 항목에 `interested_at` 필드 존재

- [x] **TC-53** 인증 실패 (401) — Authorization 헤더 없이 요청
  - 기대: `status:401` / `message:"유효하지 않거나 만료된 토큰입니다."`

---

### [09-11] 마이페이지 내 레시피 댓글 목록 — `GET /api/users/me/recipe-comments`

- [x] **TC-54** 성공 (200) — 소비자 토큰 (TC-21 댓글 작성 후)
  - 기대: `status:200` / `comments: Array` / 각 항목에 `recipe` 하위 객체 존재 (`recipe_id`, `title`, `status` 포함)

- [x] **TC-55** 인증 실패 (401) — Authorization 헤더 없이 요청
  - 기대: `status:401` / `message:"유효하지 않거나 만료된 토큰입니다."`

---

### [09-12] 대댓글 목록 조회 — `GET /api/recipes/{recipeId}/comments/{commentId}/replies`

> 비로그인 가능

- [x] **TC-56** 성공 (200) — 토큰 없이 (`{commentId}` = TC-21 댓글 ID)
  - 기대: `status:200` / `replies: Array` / `totalElements: Number` / `currentPage:0`

---

### [09-13] 대댓글 작성 — `POST /api/recipes/{recipeId}/comments/{commentId}/replies`

> TC-33(댓글 삭제) 이전에 실행

- [x] **TC-57** 성공 (201) — 소비자 토큰 + `{"content":"[5.11 통합 API 테스트] 테스트 대댓글입니다."}`
  - 기대: `status:201` / `message:"대댓글이 등록되었습니다."` / `reply.parent_comment_id:{commentId}` / `reply.like_count:0` / `reply.content:"[5.11 통합 API 테스트] 테스트 대댓글입니다."`

- [x] **TC-58** content 없음 (400) — `{"content":""}`
  - 기대: `status:400` / `message:"대댓글 내용을 입력해 주세요."`

- [x] **TC-59** 인증 실패 (401) — Authorization 헤더 없이 요청
  - 기대: `status:401` / `message:"유효하지 않거나 만료된 토큰입니다."`

- [x] **TC-60** 부모 댓글 없음 (404) — commentId = `9999999`
  - 기대: `status:404` / `message:"부모 댓글을 찾을 수 없습니다."`

---

## 10주차

---

### [10-01] 레시피 펀딩 전환 — `POST /api/recipes/{recipeId}/funding`

> **전제조건**: `{fundingReadyRecipeId}` 는 `status = FUNDING_READY` 인 레시피 ID (interest_count ≥ 100)
> DB에서 직접 확인하거나, 기존에 FUNDING_READY 상태인 레시피 ID를 레시피 목록 조회로 확인

- [x] **TC-61** 성공 (201) — 양조장 토큰 + `{fundingReadyRecipeId}` + 정상 바디
  - 바디: `{"title":"[5.11 통합 API 테스트] 테스트 펀딩 프로젝트","description":"[5.11 통합 API 테스트] 테스트용 펀딩입니다.","goal_amount":1000000,"start_date":"2026-05-20","end_date":"2026-06-20"}`
  - 기대: `status:201` / `message:"펀딩 프로젝트가 등록되었습니다."` / `funding.recipe_status:"FUNDING_IN_PROGRESS"` / `funding.funding_status:"ACTIVE"` / `funding.current_amount:0`

- [x] **TC-62** 상태 오류 (400) — PUBLISHED 상태 레시피(`{recipeId}`)로 요청
  - 기대: `status:400` / `message:"펀딩 전환 가능 상태(FUNDING_READY)인 레시피만 전환할 수 있습니다."`

- [x] **TC-63** 필수항목 누락 (400) — `goal_amount` 제거한 바디 전송
  - 기대: `status:400` / `message:"필수 항목이 누락되었습니다."`

- [x] **TC-64** 인증 실패 (401) — Authorization 헤더 없이 요청
  - 기대: `status:401` / `message:"유효하지 않거나 만료된 토큰입니다."`

- [x] **TC-65** 권한 없음 (403) — 소비자 토큰으로 요청
  - 기대: `status:403` / `message:"양조장 계정만 사용할 수 있는 기능입니다."`

- [x] **TC-66** 레시피 없음 (404) — recipeId = `9999999`
  - 기대: `status:404` / `message:"해당 레시피를 찾을 수 없습니다."`

---

### [10-02] 레시피 삭제 — `DELETE /api/recipes/{recipeId}`

> 실패 케이스 먼저 → 성공(TC-71)은 마지막에 실행

- [x] **TC-67** 인증 실패 (401) — Authorization 헤더 없이 요청
  - 기대: `status:401` / `message:"유효하지 않거나 만료된 토큰입니다."`

- [x] **TC-68** 레시피 없음 (404) — recipeId = `9999999`
  - 기대: `status:404` / `message:"해당 레시피를 찾을 수 없습니다."`

- [x] **TC-69** 타인 레시피 삭제 (403) — 양조장 토큰으로 소비자 레시피(`{recipeId}`) 삭제 시도
  - 기대: `status:403` / `message:"본인이 작성한 레시피만 삭제할 수 있습니다."`

- [x] **TC-70** 삭제 불가 상태 (400) — TC-61에서 전환된 `FUNDING_IN_PROGRESS` 레시피 삭제 시도 (양조장 토큰)
  - 기대: `status:400` / `message:"펀딩이 진행 중이거나 완료된 레시피는 삭제할 수 없습니다."`

- [x] **TC-71** 성공 (200) — 소비자 토큰(본인)으로 TC-01에서 생성한 `{recipeId}` 삭제
  - 기대: `status:200` / `message:"레시피가 삭제되었습니다."`
