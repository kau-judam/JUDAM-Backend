# Public Stats Summary API

홈 화면과 펀딩 목록 화면 상단 통계 UI에서 함께 사용할 공개 통계 API입니다.

## GET /api/stats/summary

Authorization이 필요 없습니다. 비회원도 호출할 수 있습니다.

### Request

```http
GET /api/stats/summary
```

### Success 200

```json
{
  "status": 200,
  "message": "통계 조회 성공",
  "data": {
    "home": {
      "memberCount": 1234,
      "totalFundingAmount": 987654321,
      "activeFundingCount": 12,
      "successfulFundingCount": 34
    },
    "funding": {
      "supportableFundingCount": 12,
      "totalBackerCount": 4567,
      "successfulProjectCount": 34,
      "totalRaisedAmount": 987654321
    }
  }
}
```

### Error 500

```json
{
  "status": 500,
  "message": "통계 조회 중 서버 오류가 발생했습니다."
}
```

## Field Usage

### 홈 화면: 주담과 함께한 순간들

- `data.home.memberCount`: 가입 회원 수
- `data.home.totalFundingAmount`: 누적 모금 금액
- `data.home.activeFundingCount`: 진행 중인 펀딩 수
- `data.home.successfulFundingCount`: 성공한 펀딩 수

### 펀딩 목록 화면: 상단 통계 UI

- `data.funding.supportableFundingCount`: 참여 가능 펀딩 수
- `data.funding.totalBackerCount`: 총 참여자 수
- `data.funding.successfulProjectCount`: 성공 프로젝트 수
- `data.funding.totalRaisedAmount`: 총 모금 금액

## Backend Aggregation 기준

- 회원 수
  - `users.deleted_at IS NULL`인 유효 회원 수입니다.
  - 탈퇴/삭제된 회원은 제외합니다.
- 참여 가능/진행 중 펀딩 수
  - `funding_projects.status`가 `ACTIVE` 또는 `ONGOING`
  - `start_date <= 오늘(KST)`
  - `end_date >= 오늘(KST)`
- 성공 펀딩/성공 프로젝트 수
  - `funding_projects.status`가 `SUCCESS`, `SUCCESSFUL`, `FUNDING_SUCCESS`
  - 프론트 표기는 SUCCESS 기준으로 보면 됩니다.
- 누적 모금 금액/총 모금 금액
  - `funding_projects.current_amount` 전체 합계입니다.
  - 원 단위 number로 내려갑니다.
- 총 참여자 수
  - 펀딩 카드의 참여자 수와 맞추기 위해 `funding_projects.supporter_count` 합계로 계산합니다.
  - 같은 사용자가 여러 펀딩에 참여하면 펀딩별 참여로 합산됩니다.

## Frontend Example

```ts
type PublicStatsSummary = {
  status: number;
  message: string;
  data: {
    home: {
      memberCount: number;
      totalFundingAmount: number;
      activeFundingCount: number;
      successfulFundingCount: number;
    };
    funding: {
      supportableFundingCount: number;
      totalBackerCount: number;
      successfulProjectCount: number;
      totalRaisedAmount: number;
    };
  };
};

export async function getPublicStatsSummary() {
  const response = await fetch('/api/stats/summary');
  const data = (await response.json()) as PublicStatsSummary;

  if (!response.ok) {
    throw new Error(data.message || '통계 조회에 실패했습니다.');
  }

  return data.data;
}
```
