# 일일 보고서

* 날짜 : 5월 26일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : fix/remove-brewery-recipe-api

---

## 배경 — DB에 잘못된 이미지 URL이 저장된 사건

### 발견된 증상

DB의 `recipes.image_url` 컬럼에 S3 URL이 아니라 앱(Expo) 내부 캐시 폴더의 로컬 파일 경로가 그대로 저장된 레시피가 5건 발견됐다.

| 항목 | 값 |
|---|---|
| 잘못된 값 예시 | `file:///data/user/0/host.exp.exponent/cache/ImagePicker/017fec98-a1f5-4beb-b373-69110ec94f95.jpeg` |
| 발생 건수 | 5건 (모두 `author_type='BREWERY'`) |
| 발생 시점 | 2026-05-22 ~ 2026-05-26 |
| 정상이어야 할 형식 | `https://judam-storage.s3.ap-northeast-2.amazonaws.com/uploads/{userId}/{timestamp}-{filename}` |

### 원인 진단

레시피를 등록하는 API가 두 가지가 있었다.

| 항목 | `POST /api/recipes` (소비자용) | `POST /api/recipes/brewery` (양조장 전용) |
|---|---|---|
| 누가 호출 가능 | 일반/양조장 모두 가능 | 양조장만 가능 |
| 요청 형식 | `multipart/form-data` (이미지 파일 첨부) | `application/json` (이미지 **URL 문자열** 첨부) |
| 이미지 처리 | 서버가 파일을 받아 S3에 업로드 후 URL을 DB에 저장 | 클라이언트가 보낸 URL 문자열을 그대로 DB에 저장 |
| `author_type` | JWT의 role을 보고 자동 결정 (BREWERY 계정이면 'BREWERY' 저장) | 무조건 'BREWERY' 하드코딩 저장 |

**근본 원인은 백엔드 측 설계에 있다.** 동일하게 "양조장이 레시피를 등록한다"는 기능을 위한 등록 엔드포인트를 두 개로 분리해 만들었고(소비자 API는 multipart로 파일을 받고, 양조장 전용 API는 JSON으로 URL 문자열을 받음), 그중 양조장 전용 API의 명세는 "`image_url`을 String으로 받는다"라고만 적혀 있어 어떤 형식의 URL을 넣어야 하는지를 명확히 정의하지 않았다. 그 결과 클라이언트는 양조장 등록 화면에서 expo-image-picker가 반환하는 로컬 파일 URI를 `image_url`에 그대로 담아 전송했고, 백엔드는 받은 문자열을 URL로 간주해 DB에 저장했다. 백엔드 코드는 명세대로 동작했지만, **동일 기능을 하는 API를 두 개로 만들었고 그중 한쪽의 명세가 모호해 클라이언트에 혼동을 줄 여지를 남긴 것이 핵심 원인**이다.

### 양조장 전용 API의 원래 의도와 현실의 괴리

`DefaultContext/rules/API_주차별_계획.md` L120-123을 확인해보니, `POST /api/recipes/brewery`의 원래 설계 의도는 **S3 presigned URL 기반의 분리형 업로드 흐름**이었다. 즉, 클라이언트가 백엔드로부터 임시 업로드 URL을 받아 S3에 직접 업로드한 뒤, 결과 S3 URL을 양조장 등록 API에 JSON으로 전달하는 구조다.

그러나 실제로 검토해보니:

- presigned URL 발급 API는 **구현되지 않은 상태** (`src/services/s3.service.js`에 `getSignedUrl` 호출 없음)
- 9주차 명세 문서(`DefaultContext/API 문서/9주차/양조장 레시피 등록.md`)에도 presigned 흐름이 표현되어 있지 않고, 단순히 "URL을 String으로 받는다"라고만 적혀 있음

→ 양조장 전용 API는 의도된 차별점(presigned 흐름)이 무산된 채, 권한 검증만 빼면 소비자 API와 기능이 동일하면서 위험한 빈 껍데기로 남아있었다.

---

## 작업 1 — 양조장 전용 레시피 등록 API 폐기

소비자 API(`POST /api/recipes`)가 이미 양조장 계정의 호출을 정식으로 지원하며, JWT role에 따라 `author_type`을 자동으로 `BREWERY`로 저장하기 때문에 양조장 전용 API는 사실상 중복이다. 따라서 양조장 전용 API를 폐기하고, 양조장 등록도 소비자 API로 통합하는 방향을 선택했다.

### 제거한 코드

**`src/routes/recipeRoutes.js`**
- import 구문에서 `postBreweryRecipe` 제거
- `POST /brewery` 라우트 등록 라인 1줄 제거 (위 주석 포함)
- 기존에 POST 라우트 주석에 있던 "`/:recipeId`보다 먼저 정의해야 충돌 방지" 안내는 동일하게 적용되는 GET 라우트의 주석으로 옮겨 보존

**`src/controllers/recipeController.js`**
- import 구문에서 `createBreweryRecipe` 제거
- `postBreweryRecipe` 핸들러 함수 전체 제거 (주석 포함, 약 22줄)
- `module.exports`에서 `postBreweryRecipe` 제거

**`src/services/recipeService.js`**
- `createBreweryRecipe` 서비스 함수 전체 제거 (주석 포함, 약 27줄)
- `module.exports`에서 `createBreweryRecipe` 제거

### 보존한 코드 (영향 없음)

| 보존 대상 | 이유 |
|---|---|
| `breweryMiddleware` (미들웨어 자체) | 펀딩 전환 API(`POST /api/recipes/:recipeId/funding`)에서 사용 중 |
| `GET /api/recipes/brewery` (`getBreweryRecipes`) | "양조장이 소비자 레시피 확인" 별도 기능, 이번 작업과 무관 |
| `breweryMiddleware` import 라인 | 위 `GET /brewery` 라우트가 계속 사용 |

---

## 작업 2 — 프론트엔드 팀에 전달할 작업 안내 정리

프론트엔드 팀이 Codex로 처리할 수 있도록, 양조장 등록 화면이 호출하는 API를 `POST /api/recipes/brewery` → `POST /api/recipes`로 교체하는 변경 가이드와 Codex용 프롬프트를 별도로 정리해서 전달했다.

| 변경 항목 | 변경 전 | 변경 후 |
|---|---|---|
| 엔드포인트 | `POST /api/recipes/brewery` | `POST /api/recipes` |
| Content-Type | `application/json` | `multipart/form-data` |
| 이미지 필드 | `image_url` (String) | `image` (File, FormData 첨부) |
| `author_type` 전송 | 클라가 보낼 필요 없음 (서버가 JWT role로 자동 결정) | 동일 |
| 그 외 본문 필드 | title, content, abv_range, main_ingredient, sub_ingredient, target_flavor, concept, summary | 그대로 유지 |

참고 명세: `DefaultContext/API 문서/8주차/레시피 작성.md` (구현 우선순위 08-01)

---

## 작업 3 — 명세 문서 처리

`DefaultContext/API 문서/9주차/양조장 레시피 등록.md` 파일은 폐기 표시를 위해 파일명만 `[폐기]양조장 레시피 등록.md`로 변경했다 (사용자가 직접 수행). 본문 내용은 그대로 유지.

다른 문서에서 이 명세 파일을 파일명으로 직접 참조하는 곳이 있는지 grep으로 전수 확인한 결과 **0건**. 리팩토링 대상 없음. (검색에서 잡힌 "양조장 레시피 등록" 문자열은 모두 기능명/API명 표현이며 파일 경로 참조가 아님.)

---

## 세부사항 (임시방편 / 후속 처리 필요)

### 1. DB의 잘못된 image_url 데이터 5건 — 미처리

다음 SQL을 사용자가 DBeaver에서 직접 실행해 image_url을 NULL로 정리해야 한다. (AWS_RDS_접속_메뉴얼에 따라 SQL 실행은 사용자가 직접 수행)

```sql
UPDATE recipes
SET image_url = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE recipe_id IN (61, 66, 80, 82, 83);
```

대상 레시피: 61, 66, 80, 82, 83 (모두 `author_type='BREWERY'`, `image_url`이 `file:///...` 로컬 경로).

또는 정상 S3 이미지로 교체하려면 양조장 측에 다시 등록을 요청하는 방안도 가능. 이번 작업 범위에서는 미수행.

### 2. 프론트엔드 작업 미반영 — 후속 조치 필요

이번 작업은 백엔드의 양조장 전용 API만 제거했다. 프론트엔드가 아직 `POST /api/recipes/brewery`를 호출하고 있는 상태로 배포가 나가면, 프론트의 양조장 등록 기능이 404를 받게 된다. **프론트엔드 측 API 교체 작업이 끝난 뒤에 함께 배포되도록 머지 시점을 조율해야 한다.**

### 3. 양조장 전용 API의 명세 문서 — 기능명세서/계획서 잔재

`DefaultContext/rules/API_주차별_계획.md` L120-123, `DefaultContext/rules/WBS_내용_설명.md` L61/L66, `DefaultContext/rules/기능_명세서.md` 6-6 항목 등에는 양조장 전용 등록 API가 여전히 살아있는 작업으로 기록되어 있다. DefaultContext는 동작원칙상 참조 전용이라 이번에는 수정하지 않았다. 추후 일관성 유지가 필요해지면 별도 의사결정 필요.

### 4. presigned URL 분리형 업로드 — 향후 재검토 여지

원래 양조장 API의 설계 의도였던 presigned URL 흐름은, 모바일 앱에서 대용량 이미지 업로드 부하를 분산하고 싶을 때 다시 검토할 가치가 있다. 다만 현재는 사용자 트래픽 규모와 이미지 크기를 고려할 때 소비자 API의 multipart 흐름으로 충분히 처리 가능하다고 판단해 이번 작업에서는 미구현 결정.
