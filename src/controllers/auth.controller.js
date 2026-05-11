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

const kakaoLogin = (req, res) => {
  const { KAKAO_REST_API_KEY, KAKAO_REDIRECT_URI } = process.env;

  if (!KAKAO_REST_API_KEY || !KAKAO_REDIRECT_URI) {
    return sendError(
      res,
      500,
      'Kakao OAuth environment variables are missing',
      'KAKAO_REST_API_KEY and KAKAO_REDIRECT_URI are required',
    );
  }

  const kakaoAuthUrl = new URL('https://kauth.kakao.com/oauth/authorize');
  kakaoAuthUrl.searchParams.set('response_type', 'code');
  kakaoAuthUrl.searchParams.set('client_id', KAKAO_REST_API_KEY);
  kakaoAuthUrl.searchParams.set('redirect_uri', KAKAO_REDIRECT_URI);

  return res.redirect(kakaoAuthUrl.toString());
};

const kakaoCallback = async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return sendError(res, 400, 'Authorization code is required', 'code query parameter is missing');
  }

  try {
    const tokenData = await getKakaoToken(code);
    const kakaoUserInfo = await getKakaoUserInfo(tokenData.access_token);

    const kakaoAccount = kakaoUserInfo.kakao_account || {};
    const profile = kakaoAccount.profile || {};
    const kakaoProfile = {
      kakaoId: kakaoUserInfo.id,
      email: kakaoAccount.email || null,
      nickname: profile.nickname || null,
      profileImage: profile.profile_image_url || null,
    };

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
  kakaoLogin,
  kakaoCallback,
  refreshAccessToken,
  logout,
};
