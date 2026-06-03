const BROKEN_MESSAGE_PATTERN = /[\uFFFD\u3400-\u9FFF\uF900-\uFAFF]|\?{2,}/u;

const stripQueryString = (url = '') => String(url).split('?')[0];

const isBrokenMessage = (message) =>
  typeof message === 'string' && BROKEN_MESSAGE_PATTERN.test(message);

const isSuccessStatus = (statusCode) => Number(statusCode) >= 200 && Number(statusCode) < 400;

const getStatusFallbackMessage = (statusCode, domain = '요청') => {
  if (isSuccessStatus(statusCode)) {
    return `${domain} 처리 성공`;
  }

  switch (Number(statusCode)) {
    case 400:
      return '요청값이 올바르지 않습니다.';
    case 401:
      return '로그인이 필요합니다.';
    case 403:
      return '접근 권한이 없습니다.';
    case 404:
      return '요청한 정보를 찾을 수 없습니다.';
    case 409:
      return '이미 처리된 요청입니다.';
    case 429:
      return '요청 횟수가 초과되었습니다. 잠시 후 다시 시도해주세요.';
    case 500:
      return `${domain} 처리 중 서버 오류가 발생했습니다.`;
    case 502:
    case 503:
    case 504:
      return `${domain} 처리 중 외부 서비스 오류가 발생했습니다.`;
    default:
      return `${domain} 처리 중 오류가 발생했습니다.`;
  }
};

const getCrudSuccessMessage = (method, domain) => {
  switch (method) {
    case 'GET':
      return `${domain} 조회 성공`;
    case 'POST':
      return `${domain} 생성 성공`;
    case 'PATCH':
    case 'PUT':
      return `${domain} 수정 성공`;
    case 'DELETE':
      return `${domain} 삭제 성공`;
    default:
      return `${domain} 처리 성공`;
  }
};

const getAuthMessage = ({ path, method, statusCode }) => {
  if (path.endsWith('/login') && method === 'POST') {
    if (statusCode === 200) return '로그인 성공';
    if (statusCode === 401) return '이메일 또는 비밀번호가 올바르지 않습니다.';
    if (statusCode === 400) return 'email, password는 필수입니다.';
    return getStatusFallbackMessage(statusCode, '로그인');
  }

  if (path.endsWith('/logout')) {
    return statusCode === 200 ? '로그아웃 성공' : getStatusFallbackMessage(statusCode, '로그아웃');
  }

  if (path.includes('/password/reset/request')) {
    return statusCode === 200
      ? '비밀번호 재설정 인증번호가 이메일로 발송되었습니다.'
      : getStatusFallbackMessage(statusCode, '비밀번호 재설정 인증번호 발송');
  }

  if (path.includes('/password/reset/verify')) {
    return statusCode === 200
      ? '인증번호 확인 성공'
      : getStatusFallbackMessage(statusCode, '인증번호 확인');
  }

  if (path.includes('/password/reset/confirm')) {
    return statusCode === 200
      ? '비밀번호가 성공적으로 변경되었습니다.'
      : getStatusFallbackMessage(statusCode, '비밀번호 변경');
  }

  if (path.includes('/kakao')) {
    if (statusCode === 200 || statusCode === 201) {
      return path.includes('/login') ? '카카오 로그인 성공' : '카카오 요청 처리 성공';
    }
    return getStatusFallbackMessage(statusCode, '카카오 인증');
  }

  if (path.includes('/refresh')) {
    return statusCode === 200 ? '토큰 재발급 성공' : getStatusFallbackMessage(statusCode, '토큰 재발급');
  }

  if (path.includes('/signup') || statusCode === 201) {
    return statusCode === 201 ? '회원가입 성공' : getStatusFallbackMessage(statusCode, '회원가입');
  }

  return getStatusFallbackMessage(statusCode, '인증 요청');
};

const getFundingDraftMessage = ({ path, method, statusCode }) => {
  if (path.includes('/drafts/by-funding/')) {
    if (statusCode === 200) return '펀딩 임시저장 조회 성공';
    if (statusCode === 403) return '해당 펀딩 임시저장에 접근할 권한이 없습니다.';
    if (statusCode === 404) return '펀딩 임시저장을 찾을 수 없습니다.';
    return getStatusFallbackMessage(statusCode, '펀딩 임시저장 조회');
  }

  if (statusCode === 200 || statusCode === 201) {
    return getCrudSuccessMessage(method, '펀딩 임시저장');
  }

  if (statusCode === 403) return '펀딩 임시저장에 접근할 권한이 없습니다.';
  if (statusCode === 404) return '펀딩 임시저장을 찾을 수 없습니다.';
  return getStatusFallbackMessage(statusCode, '펀딩 임시저장');
};

const getFundingMessage = ({ path, method, statusCode }) => {
  if (path.includes('/drafts')) {
    return getFundingDraftMessage({ path, method, statusCode });
  }

  if (path === '/api/fundings' && method === 'GET') {
    return statusCode === 200
      ? '펀딩 목록 조회 성공'
      : getStatusFallbackMessage(statusCode, '펀딩 목록 조회');
  }

  if (path.includes('/stats')) {
    return statusCode === 200
      ? '펀딩 통계 조회 성공'
      : getStatusFallbackMessage(statusCode, '펀딩 통계 조회');
  }

  if (path.includes('/share-link')) {
    return statusCode === 200
      ? '공유 링크 생성 성공'
      : getStatusFallbackMessage(statusCode, '공유 링크 생성');
  }

  if (path.includes('/reports')) {
    if (method === 'POST' && statusCode === 201) {
      return '검토 후 필요한 조치를 진행하겠습니다.';
    }
    return statusCode === 200
      ? '펀딩 신고 목록 조회 성공'
      : getStatusFallbackMessage(statusCode, '펀딩 신고');
  }

  if (path.includes('/orders')) {
    if (statusCode === 201 || statusCode === 200) return '후원 주문 생성 성공';
    if (statusCode === 400 || statusCode === 403) return '종료된 펀딩에는 후원할 수 없습니다.';
    return getStatusFallbackMessage(statusCode, '후원 주문');
  }

  if (path.includes('/reviews')) {
    if (statusCode === 200 || statusCode === 201) return getCrudSuccessMessage(method, '펀딩 후기');
    if (statusCode === 403) return '종료된 펀딩에 참여한 사용자만 후기를 작성할 수 있습니다.';
    if (statusCode === 409) return '이미 후기를 작성한 펀딩입니다.';
    if (statusCode === 404) return '펀딩 후기를 찾을 수 없습니다.';
    return getStatusFallbackMessage(statusCode, '펀딩 후기');
  }

  if (path.includes('/brewery-logs')) {
    return statusCode === 200 || statusCode === 201
      ? getCrudSuccessMessage(method, '양조일지')
      : getStatusFallbackMessage(statusCode, '양조일지');
  }

  if (path.includes('/questions') || path.includes('/inquiries')) {
    return statusCode === 200 || statusCode === 201
      ? getCrudSuccessMessage(method, '펀딩 문의')
      : getStatusFallbackMessage(statusCode, '펀딩 문의');
  }

  if (statusCode === 200 || statusCode === 201) {
    return getCrudSuccessMessage(method, '펀딩');
  }

  if (statusCode === 404) return '펀딩을 찾을 수 없습니다.';
  return getStatusFallbackMessage(statusCode, '펀딩');
};

const getAdminMessage = ({ path, method, statusCode }) => {
  if (path.includes('/funding-reports')) {
    if (statusCode === 200) {
      return method === 'PATCH' ? '펀딩 신고 처리 상태가 변경되었습니다.' : '펀딩 신고 목록 조회 성공';
    }
    if (statusCode === 404) return '펀딩 신고를 찾을 수 없습니다.';
    return getStatusFallbackMessage(statusCode, '펀딩 신고 관리');
  }

  if (path.includes('/fundings') && path.includes('/cancel')) {
    return statusCode === 200 ? '펀딩이 취소되었습니다.' : getStatusFallbackMessage(statusCode, '펀딩 취소');
  }

  if (path.includes('/fundings/drafts')) {
    return statusCode === 200
      ? getCrudSuccessMessage(method, '관리자 펀딩 심사')
      : getStatusFallbackMessage(statusCode, '관리자 펀딩 심사');
  }

  return getStatusFallbackMessage(statusCode, '관리자 요청');
};

const getMypageMessage = ({ path, method, statusCode }) => {
  if (path.includes('/sulbti/share-link')) {
    return statusCode === 200 ? '술BTI 공유 링크 생성 성공' : getStatusFallbackMessage(statusCode, '술BTI 공유 링크 생성');
  }

  if (path.includes('/sulbti')) {
    return statusCode === 200 || statusCode === 201
      ? getCrudSuccessMessage(method, '술BTI 결과')
      : getStatusFallbackMessage(statusCode, '술BTI 결과');
  }

  if (path.includes('/archives')) {
    return statusCode === 200 || statusCode === 201
      ? getCrudSuccessMessage(method, '아카이브')
      : getStatusFallbackMessage(statusCode, '아카이브');
  }

  if (path.includes('/nickname')) {
    return statusCode === 200 ? '닉네임 수정 성공' : getStatusFallbackMessage(statusCode, '닉네임');
  }

  if (path.includes('/phone')) {
    return statusCode === 200 ? '전화번호 인증 요청 성공' : getStatusFallbackMessage(statusCode, '전화번호');
  }

  if (path.includes('/password')) {
    return statusCode === 200 ? '비밀번호 변경 성공' : getStatusFallbackMessage(statusCode, '비밀번호 변경');
  }

  return statusCode === 200 || statusCode === 201
    ? getCrudSuccessMessage(method, '마이페이지')
    : getStatusFallbackMessage(statusCode, '마이페이지');
};

const resolveNormalizedMessage = (req, statusCode) => {
  const path = stripQueryString(req.originalUrl || req.url || '');
  const method = String(req.method || 'GET').toUpperCase();
  const context = { path, method, statusCode };

  if (path.startsWith('/api/auth')) {
    return getAuthMessage(context);
  }

  if (path.startsWith('/api/fundings')) {
    return getFundingMessage(context);
  }

  if (path.startsWith('/api/admin')) {
    return getAdminMessage(context);
  }

  if (path.startsWith('/api/mypage')) {
    return getMypageMessage(context);
  }

  return getStatusFallbackMessage(statusCode);
};

const responseMessageNormalizer = (req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    if (body && typeof body === 'object' && !Array.isArray(body) && isBrokenMessage(body.message)) {
      return originalJson({
        ...body,
        message: resolveNormalizedMessage(req, res.statusCode),
      });
    }

    return originalJson(body);
  };

  next();
};

module.exports = responseMessageNormalizer;
