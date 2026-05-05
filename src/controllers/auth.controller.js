const jwt = require('jsonwebtoken');
const { getKakaoToken, getKakaoUserInfo } = require('../services/kakao.service');
const { findOrCreateKakaoUser } = require('../services/user.service');

const kakaoLogin = (req, res) => {
  const { KAKAO_REST_API_KEY, KAKAO_REDIRECT_URI } = process.env;

  if (!KAKAO_REST_API_KEY || !KAKAO_REDIRECT_URI) {
    return res.status(500).json({
      message: 'Kakao OAuth environment variables are missing',
    });
  }

  const kakaoAuthUrl = new URL('https://kauth.kakao.com/oauth/authorize');
  kakaoAuthUrl.searchParams.set('response_type', 'code');
  kakaoAuthUrl.searchParams.set('client_id', KAKAO_REST_API_KEY);
  kakaoAuthUrl.searchParams.set('redirect_uri', KAKAO_REDIRECT_URI);

  return res.redirect(kakaoAuthUrl.toString());
};

const kakaoCallback = async (req, res) => {
  const { code } = req.query;
  const { JWT_SECRET } = process.env;

  if (!code) {
    return res.status(400).json({
      message: 'Authorization code is required',
    });
  }

  if (!JWT_SECRET) {
    return res.status(500).json({
      message: 'JWT_SECRET environment variable is missing',
    });
  }

  try {
    const tokenData = await getKakaoToken(code);
    const kakaoUserInfo = await getKakaoUserInfo(tokenData.access_token);

    const kakaoAccount = kakaoUserInfo.kakao_account || {};
    const profile = kakaoAccount.profile || {};
    const user = {
      kakaoId: kakaoUserInfo.id,
      email: kakaoAccount.email || null,
      nickname: profile.nickname || null,
      profileImage: profile.profile_image_url || null,
    };

    const dbUser = await findOrCreateKakaoUser(user);

    const accessToken = jwt.sign(
      {
        userId: dbUser.user_id,
        provider: 'kakao',
        role: dbUser.role,
      },
      JWT_SECRET,
      {
        expiresIn: '7d',
      },
    );

    return res.status(200).json({
      message: 'kakao login success',
      accessToken,
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
  console.error('카카오 로그인 실패 상세:', error);
  console.error('카카오 로그인 실패 응답:', error.response?.data);
  console.error('카카오 로그인 실패 메시지:', error.message);

  return res.status(500).json({
    message: 'kakao login failed',
    error: error.response?.data || error.message || String(error),
  });
}
}

module.exports = { kakaoLogin, kakaoCallback };
