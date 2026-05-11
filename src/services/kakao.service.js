const axios = require('axios');

const getKakaoToken = async (code) => {
  const { KAKAO_REST_API_KEY, KAKAO_REDIRECT_URI, KAKAO_CLIENT_SECRET } = process.env;

  if (!KAKAO_REST_API_KEY || !KAKAO_REDIRECT_URI || !KAKAO_CLIENT_SECRET) {
    const error = new Error('Kakao OAuth environment variables are missing');
    error.statusCode = 500;
    throw error;
  }

  const tokenParams = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: KAKAO_REST_API_KEY,
    redirect_uri: KAKAO_REDIRECT_URI,
    client_secret: KAKAO_CLIENT_SECRET,
    code,
  });

  const response = await axios.post(
    'https://kauth.kakao.com/oauth/token',
    tokenParams.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
    },
  );

  return response.data;
};

const getKakaoUserInfo = async (accessToken) => {
  const response = await axios.get('https://kapi.kakao.com/v2/user/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    },
  });

  return response.data;
};

module.exports = { getKakaoToken, getKakaoUserInfo };
