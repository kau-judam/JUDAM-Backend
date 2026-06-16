# 회원 탈퇴 API

## DELETE /api/users/me

로그인한 사용자의 회원 탈퇴를 처리합니다.

### Authorization

```http
Authorization: Bearer {accessToken}
```

### Request

```json
{
  "nickname": "현재닉네임"
}
```

- `nickname`은 필수입니다.
- 프론트에서 닉네임 확인 UI를 제공하더라도, 백엔드가 토큰의 사용자 닉네임과 요청 닉네임을 다시 검증합니다.
- 공백은 앞뒤 trim 후 비교합니다.

### Success 200

```json
{
  "status": 200,
  "message": "회원 탈퇴가 완료되었습니다."
}
```

성공 시 프론트는 저장된 accessToken/refreshToken과 유저 상태를 제거한 뒤 온보딩 또는 로그인 화면으로 이동하면 됩니다.

### Nickname Mismatch 400

```json
{
  "status": 400,
  "message": "닉네임이 일치하지 않습니다."
}
```

닉네임이 비어 있으면 아래 응답이 반환됩니다.

```json
{
  "status": 400,
  "message": "닉네임을 입력해주세요."
}
```

### Withdrawal Blocked 409

```json
{
  "status": 409,
  "message": "진행 중인 펀딩 또는 주문이 있어 탈퇴할 수 없습니다."
}
```

현재 제한 조건:

- 진행 중인 주문이 있는 경우
  - `orders.order_status`가 `PENDING` 또는 `PAID`
  - 그리고 `orders.delivery_status`가 `DELIVERED`, `CANCELED`, `CANCELLED`가 아닌 경우
- 진행 중인 결제가 있는 경우
  - 해당 사용자의 주문에 연결된 `payments.payment_status`가 `READY` 또는 `PENDING`
- 사용자가 생성자인 진행 중인 펀딩이 있는 경우
  - `funding_projects.status`가 심사/예정/진행/제작/배송 계열 상태인 경우

### Backend 처리 내용

- Authorization 토큰에서 `userId` 추출
- `users.nickname`과 요청 `nickname` 재검증
- 제한 조건 통과 시 트랜잭션으로 처리
- `refresh_tokens.revoked_at` 갱신으로 refreshToken 폐기
- `users.deleted_at` 설정으로 soft delete
- 사용자 개인정보 비식별화
  - `users.email`, `password`, `phone_number`, `kakao_id`, `profile_image` 제거
  - `users.nickname`은 `탈퇴회원_{userId}`로 변경
  - 주문 배송 개인정보 제거
  - 양조장 프로필/인증의 연락처, 주소, 문서 URL/키 제거

### Frontend Flow

1. 설정 화면에서 회원 탈퇴 클릭
2. 닉네임 입력 모달 표시
3. 현재 계정 닉네임과 일치할 때 최종 확인 모달 표시
4. 최종 확인 시 `DELETE /api/users/me` 호출
5. 200이면 토큰/유저 상태 제거 후 온보딩 또는 로그인 화면으로 이동
6. 400이면 닉네임 입력 모달에 오류 표시
7. 409이면 제한 사유 메시지 표시
