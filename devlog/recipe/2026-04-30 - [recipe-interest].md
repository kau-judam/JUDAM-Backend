# 일일 보고서

* 날짜 : 4월 30일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : feature/recipe-interest

---

### 작업 1 — `POST /api/recipes/:recipeId/interests` 관심 등록 구현

**이 API가 하는 일**: 로그인한 사용자가 특정 레시피에 관심(좋아요)을 등록한다. 등록 후 해당 레시피의 관심 수가 1 올라가며, 관심 수가 100개 이상이 되면 레시피가 자동으로 "펀딩 전환 가능" 상태로 바뀐다.

**요청 방식**

- 로그인 토큰(JWT)이 반드시 있어야 한다.
- 요청 바디는 없고, URL에 레시피 ID만 넣으면 된다.
  - 예: `POST /api/recipes/3/interests`

**응답 구조**

```json
{
  "status": 200,
  "message": "관심 등록 완료",
  "data": {
    "recipe_id": 3,
    "interest_count": 68,
    "is_fundable": false
  }
}
```

**실패 케이스 3가지**

| 상황 | 응답 코드 | 메시지 |
|---|---|---|
| 같은 레시피에 이미 관심 등록한 경우 | 400 | 이미 관심 등록한 레시피입니다. |
| 존재하지 않는 레시피 ID | 404 | 해당 레시피를 찾을 수 없습니다. |
| 토큰 없거나 만료 | 401 | Unauthorized: token is missing / invalid token |

---

### 작업 2 — `DELETE /api/recipes/:recipeId/interests` 관심 해제 구현

**이 API가 하는 일**: 이전에 등록한 관심을 취소한다. 관심 수가 1 감소하며, 0 미만으로는 절대 내려가지 않는다.

**중요한 운영 정책**: 관심 해제를 해도 이미 `is_fundable = true`가 된 레시피는 다시 `false`로 되돌리지 않는다. 한 번 펀딩 전환 가능 상태가 된 레시피는 유지된다.

**응답 구조**

```json
{
  "status": 200,
  "message": "관심 해제 완료",
  "data": {
    "recipe_id": 3,
    "interest_count": 67,
    "is_fundable": false
  }
}
```

**실패 케이스**

| 상황 | 응답 코드 | 메시지 |
|---|---|---|
| 관심 등록한 적 없는 레시피 | 400 | 관심 등록 내역이 없습니다. |
| 존재하지 않는 레시피 ID | 404 | 해당 레시피를 찾을 수 없습니다. |

---

### 작업 3 — 임계값 초과 시 자동 상태 전환 로직 구현

**이 로직이 하는 일**: 관심 등록 시 레시피의 관심 수가 **100개 이상**이 되면, 서버가 자동으로 두 가지를 변경한다.

1. `is_fundable = true` → 양조장이 이 레시피를 펀딩으로 전환할 수 있는 상태가 됨
2. `status = 'FUNDING_READY'` → 레시피 상태가 "펀딩 준비 완료"로 바뀜

이 처리는 사람이 직접 하지 않아도 되고, 관심 등록 API를 호출하면 서버 내부에서 자동으로 처리된다.

**임계값**: 현재 100으로 설정 (서비스 상수 `INTEREST_THRESHOLD`로 관리 — 나중에 바꾸고 싶으면 이 값만 수정하면 됨)

---

### 작업 4 — 동일 사용자 중복 등록 방지

같은 사람이 같은 레시피에 관심을 두 번 등록하려 하면 자동으로 막힌다. 내부적으로 `(user_id, recipe_id)` 조합을 체크해서 이미 등록된 경우 400 오류를 반환한다.

---

### 세부사항 (임시방편 처리 내용)

**현재 DB가 연결되지 않은 상태**라서 관심 등록 내역을 실제 DB의 `RECIPE_INTERESTS` 테이블에 저장하지 못하고, `MOCK_INTERESTS`라는 서버 메모리 배열에 임시 저장하고 있다.

- **문제**: 서버를 재시작하면 관심 등록 내역이 모두 사라진다.
- **임시 처리**: `recipeService.js` 파일 내 `MOCK_INTERESTS = []` 배열에 `{ recipe_id, user_id }` 형태로 저장.
- **나중에 해야 할 일**: AWS RDS가 연결되고 `RECIPE_INTERESTS` 테이블이 생성되면, `MOCK_INTERESTS` 배열을 삭제하고 `addInterest` / `removeInterest` 함수 내부의 로직을 실제 DB INSERT / DELETE 쿼리로 교체해야 한다. `RECIPES.interest_count` 업데이트도 DB UPDATE 쿼리로 전환 필요.
