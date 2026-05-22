const bcrypt = require('bcrypt');
const { getKakaoToken, getKakaoUserInfo } = require('../services/kakao.service');
const {
  findOrCreateKakaoUser,
  findUserByEmail,
  createLocalUser,
  updateLocalUserLastLogin,
  isNicknameExists,
} = require('../services/user.service');
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

const PASSWORD_SALT_ROUNDS = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeString = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
};

const mapSignupUserResponse = (user) => ({
  userId: String(user.user_id),
  email: user.email,
  nickname: user.nickname,
  phoneNumber: user.phone_number,
  provider: user.provider,
  role: user.role,
});

const mapLoginUserResponse = (user) => ({
  userId: String(user.user_id),
  email: user.email,
  nickname: user.nickname,
  phoneNumber: user.phone_number,
  provider: user.provider,
  role: user.role,
  profileImage: user.profile_image,
});

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

const signup = async (req, res) => {
  const email = normalizeString(req.body?.email).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const nickname = normalizeString(req.body?.nickname);
  const phoneNumber = req.body?.phoneNumber === undefined || req.body?.phoneNumber === null
    ? null
    : normalizeString(req.body.phoneNumber);

  if (!email || !password || !nickname) {
    return res.status(400).json({
      status: 400,
      message: 'email, password, nickname은 필수입니다.',
    });
  }

  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({
      status: 400,
      message: '이메일 형식이 올바르지 않습니다.',
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      status: 400,
      message: '비밀번호는 8자 이상이어야 합니다.',
    });
  }

  try {
    const existingUser = await findUserByEmail(email);

    if (existingUser) {
      return res.status(409).json({
        status: 409,
        message: '이미 사용 중인 이메일입니다.',
      });
    }

    const duplicatedNickname = await isNicknameExists(nickname);

    if (duplicatedNickname) {
      return res.status(409).json({
        status: 409,
        message: '이미 사용 중인 닉네임입니다.',
      });
    }

    const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
    const user = await createLocalUser({
      email,
      passwordHash,
      nickname,
      phoneNumber,
    });

    return res.status(201).json({
      status: 201,
      message: '회원가입 성공',
      data: mapSignupUserResponse(user),
    });
  } catch (error) {
    if (error.code === '23505') {
      const existingUser = await findUserByEmail(email);

      if (existingUser) {
        return res.status(409).json({
          status: 409,
          message: '이미 사용 중인 이메일입니다.',
        });
      }

      const duplicatedNickname = await isNicknameExists(nickname);

      if (duplicatedNickname) {
        return res.status(409).json({
          status: 409,
          message: '이미 사용 중인 닉네임입니다.',
        });
      }

      return res.status(409).json({
        status: 409,
        message: '이미 사용 중인 이메일입니다.',
      });
    }

    return res.status(500).json({
      status: 500,
      message: '회원가입 중 서버 오류가 발생했습니다.',
    });
  }
};

const login = async (req, res) => {
  const email = normalizeString(req.body?.email).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!email || !password) {
    return res.status(400).json({
      status: 400,
      message: 'email, password는 필수입니다.',
    });
  }

  try {
    const user = await findUserByEmail(email);

    if (!user) {
      return res.status(401).json({
        status: 401,
        message: '이메일 또는 비밀번호가 올바르지 않습니다.',
      });
    }

    if (user.provider !== 'local') {
      return res.status(400).json({
        status: 400,
        message: '소셜 로그인으로 가입된 계정입니다.',
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password || '');

    if (!isPasswordValid) {
      return res.status(401).json({
        status: 401,
        message: '이메일 또는 비밀번호가 올바르지 않습니다.',
      });
    }

    const loggedInUser = await updateLocalUserLastLogin(user.user_id);
    const accessToken = generateAccessToken(loggedInUser);
    const refreshToken = await issueRefreshToken(loggedInUser.user_id);

    return res.status(200).json({
      status: 200,
      message: '로그인 성공',
      data: {
        accessToken,
        refreshToken,
        user: mapLoginUserResponse(loggedInUser),
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '로그인 중 서버 오류가 발생했습니다.',
    });
  }
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
  signup,
  login,
  kakaoLoginUrl,
  kakaoLogin,
  kakaoCallback,
  kakaoLoginByCode,
  refreshAccessToken,
  logout,
};
