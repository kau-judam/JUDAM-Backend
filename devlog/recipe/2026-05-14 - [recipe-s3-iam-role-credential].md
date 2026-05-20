# 일일 보고서

* 날짜 : 5월 14일
* 작성자 : 장요한(by Claude Code)
* 작업 브랜치 : fix/recipe-s3-iam-role-credential

---

### 작업 1 — 이미지 포함 레시피 등록 시 500 에러 원인 분석

**문제 상황**: 프론트엔드로부터 이미지 없이 레시피 등록은 정상이지만, 이미지를 포함하면 500 에러가 발생한다는 피드백을 받음. Thunder Client로 실제 서버(`http://43.202.24.223:3000/api/recipes`)에서 직접 재현 확인.

**원인 분석 과정**

1. `recipeController.js`의 catch 블록에 `console.error`가 없어 에러가 서버 로그에 전혀 남지 않는 상태였음 → 팀장도 PM2 로그에서 원인 파악 불가
2. EC2 서버의 `.env`를 통해 `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`가 설정되어 있지 않음을 확인 → EC2는 IAM Role 기반으로 S3에 접근하는 구조
3. `s3.service.js`에서 `S3Client` 생성 시 `credentials` 블록을 항상 명시적으로 전달하고 있었음

**근본 원인**: AWS SDK는 `credentials` 객체가 명시적으로 전달되면 IAM Role 자동 인식을 건너뜀. EC2 환경에서 `AWS_ACCESS_KEY_ID`가 `undefined`인 채로 `credentials` 블록이 전달되면 SDK가 `undefined` 값으로 인증을 시도하다 실패 → S3 업로드 에러 → 500 반환.

| 환경 | AWS_ACCESS_KEY_ID | 기존 동작 | 기존 결과 |
|------|-------------------|-----------|-----------|
| 로컬 | .env에 있음 | credentials 블록 사용 | 정상 |
| EC2  | 없음 (IAM Role 사용) | undefined로 credentials 블록 전달 | S3 인증 실패 → 500 |

---

### 작업 2 — `s3.service.js` 수정

**수정 내용**: `AWS_ACCESS_KEY_ID` 환경변수가 있을 때만 `credentials` 블록을 전달하도록 조건부 처리. 없으면 SDK가 자동으로 IAM Role을 사용함.

**수정 전**
```js
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
```

**수정 후**
```js
const s3Config = { region: process.env.AWS_REGION };
if (process.env.AWS_ACCESS_KEY_ID) {
  s3Config.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}
const s3 = new S3Client(s3Config);
```

| 환경 | AWS_ACCESS_KEY_ID | 수정 후 동작 | 예상 결과 |
|------|-------------------|-------------|-----------|
| 로컬 | .env에 있음 | credentials 블록 사용 | 기존과 동일, 정상 |
| EC2  | 없음 | credentials 블록 생략 → IAM Role 자동 사용 | 정상 |

---

### 참고사항

- 이 버그는 EC2 배포 환경에서만 재현되며 로컬에서는 증상이 나타나지 않아 디버깅이 어려운 케이스였음. EC2 IAM Role 방식과 .env 키 방식을 혼용하는 팀 구성에서 발생할 수 있는 전형적인 환경 차이 문제.
- EC2 배포 후 이미지 포함 레시피 등록 API를 다시 테스트해서 201 응답 및 S3 업로드 확인 필요.
- `recipeController.js`의 catch 블록에 `console.error`가 없어 향후 S3 관련 에러 발생 시에도 로그 추적이 불가능한 상태. 추후 에러 로깅 추가를 고려할 것.
