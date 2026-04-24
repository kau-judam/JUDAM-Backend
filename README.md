# JUDAM-Backend

## Git 협업 가이드

### 기본 브랜치 구조

- `main`: 최종 배포용 브랜치
- `develop`: 개발 통합 브랜치
- `feature/*`: 기능 개발 브랜치
- `fix/*`: 버그 수정 브랜치

---

### 작업 순서

1. 최신 develop 브랜치 받기

```bash
git checkout develop
git pull origin develop
```

2. 작업 브랜치 생성

```bash
git checkout -b feature/기능명
```

예시:

```bash
git checkout -b feature/login-api
```

3. 작업 후 변경 사항 확인

```bash
git status
```

4. 변경 파일 추가

```bash
git add .
```

5. 커밋 작성

```bash
git commit -m "feat: 로그인 API 구현"
```

6. 원격 저장소에 푸시

```bash
git push origin feature/기능명
```

예시:

```bash
git push origin feature/login-api
```

7. GitHub에서 Pull Request 생성

- PR 방향: `feature/기능명` → `develop`
- 작업 내용과 테스트 여부를 작성한다.
- 리뷰 후 `develop` 브랜치에 병합한다.

---

### 커밋 메시지 규칙

| 태그 | 의미 | 예시 |
|---|---|---|
| `feat` | 새로운 기능 추가 | `feat: 로그인 API 구현` |
| `fix` | 버그 수정 | `fix: 토큰 검증 오류 수정` |
| `docs` | 문서 수정 | `docs: README 협업 가이드 추가` |
| `refactor` | 코드 리팩토링 | `refactor: 서비스 로직 분리` |
| `test` | 테스트 코드 추가/수정 | `test: 로그인 API 테스트 추가` |
| `chore` | 설정, 빌드, 기타 작업 | `chore: eslint 설정 추가` |

---

### PR 작성 예시

```md
## 작업 내용
- 로그인 API 구현
- JWT 토큰 발급 로직 추가
- 로그인 실패 시 에러 응답 처리

## 확인 사항
- [ ] 로컬 서버 실행 확인
- [ ] API 요청/응답 테스트 완료
- [ ] 충돌 여부 확인
```

---

### 주의사항

- `main` 브랜치에 직접 push하지 않는다.
- `develop` 브랜치에도 직접 push하지 않고 PR을 통해 병합한다.
- 작업 시작 전 항상 `git pull origin develop`을 먼저 실행한다.
- 기능 단위로 브랜치를 생성하고 커밋한다.
- `.env`, `node_modules`, 빌드 결과물은 커밋하지 않는다.
- 충돌 발생 시 작업자가 해결한 뒤 다시 push한다.

---

### 전체 흐름 요약

```bash
git checkout develop
git pull origin develop

git checkout -b feature/기능명

# 작업 진행

git status
git add .
git commit -m "feat: 작업 내용"
git push origin feature/기능명
```

이후 GitHub에서 Pull Request를 생성한다.

```txt
feature/기능명 → develop
```
