const jwt = require('jsonwebtoken');
const { getKakaoToken, getKakaoUserInfo } = require('../services/kakao.service');

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

    // TODO: Save or update Kakao user in DB.
    const accessToken = jwt.sign(
      {
        provider: 'kakao',
        kakaoId: user.kakaoId,
        email: user.email,
      },
      JWT_SECRET,
      {
        expiresIn: '7d',
      },
    );

    return res.status(200).json({
      message: 'kakao login success',
      accessToken,
      user,
    });
  } catch (error) {
    const status = error.statusCode || error.response?.status || 500;

    return res.status(status).json({
      message: 'kakao login failed',
      error: error.response?.data || error.message,
    });
  }
};

module.exports = { kakaoLogin, kakaoCallback };
