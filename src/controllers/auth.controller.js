const { getKakaoToken, getKakaoUserInfo } = require('../services/kakao.service');
const { findOrCreateKakaoUser } = require('../services/user.service');
const {
  generateAccessToken,
  issueRefreshToken,
  refreshAccessToken: refreshAccessTokenService,
  revokeRefreshToken,
} = require('../services/token.service');

const sendError = (res, status, message, error) => {
  return res.status(status).json({
    message,
    error,
  });
};

const buildKakaoProfile = (kakaoUserInfo) => {
  const kakaoAccount = kakaoUserInfo.kakao_account || {};
  const profile = kakaoAccount.profile || {};

  return {
    kakaoId: kakaoUserInfo.id,
    email: kakaoAccount.email || null,
    nickname: profile.nickname || null,
    profileImage: profile.profile_image_url || null,
  };
};

const getBackendRedirectUri = () => process.env.KAKAO_BACKEND_REDIRECT_URI || process.env.KAKAO_REDIRECT_URI;

const getFrontendRedirectUri = () => process.env.KAKAO_FRONTEND_REDIRECT_URI || process.env.KAKAO_REDIRECT_URI;

const buildKakaoAuthUrl = (redirectUri) => {
  const kakaoAuthUrl = new URL('https://kauth.kakao.com/oauth/authorize');
  kakaoAuthUrl.searchParams.set('response_type', 'code');
  kakaoAuthUrl.searchParams.set('client_id', process.env.KAKAO_REST_API_KEY);
  kakaoAuthUrl.searchParams.set('redirect_uri', redirectUri);

  return kakaoAuthUrl.toString();
};

const kakaoLoginUrl = (req, res) => {
  const frontendRedirectUri = getFrontendRedirectUri();

  if (!process.env.KAKAO_REST_API_KEY || !frontendRedirectUri) {
    return res.status(500).json({
      status: 500,
      message: '서버 내부 오류',
    });
  }

  return res.status(200).json({
    status: 200,
    message: '카카오 로그인 URL 조회 성공',
    data: {
      url: buildKakaoAuthUrl(frontendRedirectUri),
    },
  });
};

const kakaoLogin = (req, res) => {
  const { KAKAO_REST_API_KEY } = process.env;
  const backendRedirectUri = getBackendRedirectUri();

  if (!KAKAO_REST_API_KEY || !backendRedirectUri) {
    return sendError(
      res,
      500,
      'Kakao OAuth environment variables are missing',
      'KAKAO_REST_API_KEY and KAKAO_BACKEND_REDIRECT_URI or KAKAO_REDIRECT_URI are required',
    );
  }

  return res.redirect(buildKakaoAuthUrl(backendRedirectUri));
};

const kakaoCallback = async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return sendError(res, 400, 'Authorization code is required', 'code query parameter is missing');
  }

  try {
    const tokenData = await getKakaoToken(code, getBackendRedirectUri());
    const kakaoUserInfo = await getKakaoUserInfo(tokenData.access_token);
    const kakaoProfile = buildKakaoProfile(kakaoUserInfo);
    const dbUser = await findOrCreateKakaoUser(kakaoProfile);
    const accessToken = generateAccessToken(dbUser);
    const refreshToken = await issueRefreshToken(dbUser.user_id);

    return res.status(200).json({
      message: 'kakao login success',
      accessToken,
      refreshToken,
      user: {
        userId: dbUser.user_id,
        email: dbUser.email,
        nickname: dbUser.nickname,
        role: dbUser.role,
        provider: dbUser.provider,
        profileImage: dbUser.profile_image,
        lastLoginAt: dbUser.last_login_at,
      },
    });
  } catch (error) {
    return sendError(
      res,
      error.statusCode || error.response?.status || 500,
      'kakao login failed',
      error.response?.data || error.detail || error.message || String(error),
    );
  }
};

const kakaoLoginByCode = async (req, res) => {
  const { code } = req.body || {};

  if (!code) {
    return res.status(400).json({
      status: 400,
      message: '카카오 인가 코드가 필요합니다.',
    });
  }

  try {
    let tokenData;
    try {
      tokenData = await getKakaoToken(code, getFrontendRedirectUri());
    } catch (error) {
      if (error.statusCode === 500) {
        throw error;
      }

      return res.status(401).json({
        status: 401,
        message: '카카오 인증에 실패했습니다.',
      });
    }

    let kakaoUserInfo;
    try {
      kakaoUserInfo = await getKakaoUserInfo(tokenData.access_token);
    } catch (error) {
      return res.status(502).json({
        status: 502,
        message: '카카오 사용자 정보 조회에 실패했습니다.',
      });
    }

    const kakaoProfile = buildKakaoProfile(kakaoUserInfo);
    const dbUser = await findOrCreateKakaoUser(kakaoProfile);
    const accessToken = generateAccessToken(dbUser);

    return res.status(200).json({
      status: 200,
      message: '카카오 로그인 성공',
      data: {
        access_token: accessToken,
        user: {
          user_id: dbUser.user_id,
          email: dbUser.email,
          nickname: dbUser.nickname,
          profile_image: dbUser.profile_image,
          role: dbUser.role,
        },
      },
    });
  } catch (error) {
  console.error('POST kakao login error:', {
    message: error.message,
    status: error.response?.status,
    data: error.response?.data,
    code: error.code,
    stack: error.stack,
  });

  if (error.response?.status === 401) {
    return res.status(401).json({
      status: 401,
      message: '카카오 인증에 실패했습니다.',
    });
  }

  if (error.response?.config?.url?.includes('/v2/user/me')) {
    return res.status(502).json({
      status: 502,
      message: '카카오 사용자 정보 조회에 실패했습니다.',
    });
  }

  return res.status(500).json({
    status: 500,
    message: '서버 내부 오류',
  });
}
}

const refreshAccessToken = async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return sendError(res, 400, 'refreshToken is required', 'refreshToken is missing');
  }

  try {
    const accessToken = await refreshAccessTokenService(refreshToken);

    return res.status(200).json({
      message: 'access token refreshed',
      accessToken,
    });
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || 'access token refresh failed',
      error.detail || error.message,
    );
  }
};

const logout = async (req, res) => {
  const { refreshToken } = req.body;

  try {
    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    }

    return res.status(200).json({
      message: 'logout success',
    });
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || 'logout failed',
      error.detail || error.message,
    );
  }
};

module.exports = {
  kakaoLoginUrl,
  kakaoLogin,
  kakaoCallback,
  kakaoLoginByCode,
  refreshAccessToken,
  logout,
};
