# 일일 보고서

* 날짜 : 5월 22일 (2차)
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : fix/post-update-keep-images

---

### 작업 배경 — 프론트엔드 요청

12주차 게시글 수정 API(`PUT /api/posts/:postId`)의 이미지 동작이 **완전 교체 방식**이라, 프론트엔드에서 다음과 같은 UX 문제가 발생했다.

- 기존 게시글에 이미지 A, B가 있는 상태에서 사용자가 "이미지 C 추가" 의도로 새 파일 1장만 첨부하고 저장 누름
- 백엔드는 받은 파일로 완전 교체 → A, B가 사라지고 C만 남음
- **기대**: A, B, C 모두 유지

원인은 백엔드가 "남길 기존 이미지" 정보를 요청에서 받지 않기 때문. 텍스트는 프론트 화면의 입력란이 기존 값으로 미리 채워져 있어서 자연스럽게 유지되지만, 이미지는 새로 첨부한 것만 form-data에 들어가 백엔드 입장에서는 "기존 다 지우고 이걸로 교체"로 해석됐다.

---

### 작업 1 — API 명세서 보완 (`게시글 수정.md`)

`existing_image_urls` form-data 필드를 추가하고 이미지 처리 흐름을 재정의했다.

**Request Body 필드 추가**
| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| existing_image_urls | String (JSON 배열) | | 남길 기존 이미지 S3 URL 배열을 JSON 문자열로 전송. 예: `'["https://.../a.png","https://.../b.png"]'` |
| images | File[] | | 새로 추가할 파일. existing_image_urls와 합쳐 총 5개 이하 |

**구현 메모 — 새 흐름 6단계**
1. `existing_image_urls`를 `JSON.parse` (미전송 → `[]`)
2. **보안 검증**: 각 URL이 현재 `post_id`의 `post_images`에 실제 존재하는지 확인. 위반 시 400 (다른 게시글 이미지·외부 URL 차단)
3. `images` 파일 → S3 업로드 → 새 URL 배열
4. `finalUrls = [...existing, ...new]`. 길이 > 5면 400
5. `post_images` 전체 삭제 → `finalUrls`를 `sequence` 0,1,2... 순서로 재삽입
6. `existing=[]` + `images` 미전송 → 이미지 전체 삭제

**FAIL 1 (400) 케이스 확장** — 4가지 메시지 명시 (필수 누락 / 형식 오류 / 유효하지 않은 URL / 5개 초과)

---

### 작업 2 — 백엔드 코드 변경

**`src/services/postService.js` — `updatePost` 시그니처 변경**

```js
updatePost(postId, userId, { title, content, existingImageUrls = [], newImageUrls = [] })
```

- 트랜잭션 안에서 권한 검증 → 보안 검증 → 합산 길이 검증 → posts UPDATE → post_images 전체 삭제 → finalUrls 재삽입
- `MAX_POST_IMAGES = 5` 상수 도입
- 보안 검증: `SELECT image_url FROM post_images WHERE post_id = $1` 결과를 `Set`으로 만들고 `existingImageUrls` 각 항목을 `has()` 체크. 위반 시 `statusCode=400` 에러 throw

**`src/controllers/postController.js` — `putPost` 핸들러 변경**

- `body.existing_image_urls`를 `JSON.parse`로 파싱 (try/catch로 형식 오류 400)
- 결과가 배열이 아니거나 문자열 외 원소 포함 시 400
- service 호출 시 `existingImageUrls`/`newImageUrls` 두 배열로 분리해 전달
- catch 블록에 `error.statusCode === 400` 분기 추가 (service에서 throw한 400 메시지 전달)

---

### 작업 3 — 로컬 테스트 11종 통과

post_id=23에 더미 이미지 2장을 첨부한 뒤 시나리오를 연속 실행. 마지막에 글 삭제로 청소.

| # | 시나리오 | 결과 |
|---|---|---|
| 1 | existing=[A,B] + 새 1장 | 200, 3장 (A,B,new) |
| 2 | GET sequence 0,1,2 정렬 | ✓ |
| 3 | existing=[A,C] (B 제거 의도) | 200, 2장 (A,C만 남음) |
| 4 | existing=`not-json` | 400 형식 오류 |
| 5 | existing=`["https://evil.com/x.png"]` | 400 보안 검증 |
| 6 | existing=[삭제된 URL] | 400 보안 검증 |
| 7 | existing 2장 + 새 4장 (합산 6) | 400 5개 초과 |
| 8 | existing=`{}` (배열 아님) | 400 형식 오류 |
| 9 | existing=`[]` + 새 0장 | 200, 0장 (전체 삭제) |
| 10 | GET (images=[]) | ✓ |
| 청소 | DELETE /posts/23 | 200 |

---

### 수정한 파일 3개

| 파일 | 변경 내용 |
|---|---|
| `src/services/postService.js` | `updatePost` 시그니처(existingImageUrls/newImageUrls) + 보안 검증 + 합산 길이 검증 |
| `src/controllers/postController.js` | `putPost`에 JSON 파싱·형식 검증, service 호출 시그니처 변경, 400 분기 추가 |
| `00.DefaultContext/API 문서/12주차/게시글 수정.md` | Request Body 표·구현 메모·FAIL 1 메시지 확장 |

---

### 세부사항

- **S3 객체 정리는 여전히 안 함**: `existing_image_urls`에서 빠진 URL의 S3 객체는 orphan으로 남는다. 12주차 PUT/DELETE와 동일한 정책 유지 (기존 POST 작성 API와 일관성). 스토리지 비용 누적이 문제가 되면 별도 배치 잡 또는 트랜잭션 후 `s3.deleteObject` 추가 필요.
- **로컬 테스트 중 nodemon stdout 캡처 문제**: 코드 변경 후 `Out` 파일에 console.log가 즉시 안 보이는 현상이 있어 서버를 한 번 완전히 재시작했다. 재시작 후 정상. 원인은 nodemon이 npm script 내부 dotenv 래퍼를 거치면서 stdout 버퍼링이 늦어진 듯. 운영 시에는 영향 없는 로컬 환경 이슈.
- **응답 메시지 한국어 일관성**: 새 400 케이스 메시지("existing_image_urls는 문자열 배열의 JSON이어야 합니다." 등)는 명세서 FAIL 1에 함께 명시. 향후 다국어 처리 시 i18n 키로 분리 필요.
