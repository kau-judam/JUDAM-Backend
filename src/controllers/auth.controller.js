const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { getKakaoToken, getKakaoUserInfo } = require('../services/kakao.service');
const {
  findUserByKakaoId,
  findUserByEmail,
  createKakaoUser,
  updateKakaoUserProfileCompletion,
  createLocalUser,
  updateLocalUserLastLogin,
  updateUserLastLogin,
  updateUserRole,
  isNicknameUsedByAnotherUser,
  isNicknameExists,
  createPasswordResetVerification,
  verifyPasswordResetVerification,
  resetPasswordWithVerification,
} = require('../services/user.service');
const {
  generateAccessToken,
  issueRefreshToken,
  generateKakaoSignupToken,
  verifyKakaoSignupToken,
  refreshAccessToken: refreshAccessTokenService,
  revokeRefreshToken,
} = require('../services/token.service');
const {
  requestAuthPhoneVerification,
  confirmAuthPhoneVerification,
  verifyAuthPhoneVerificationToken,
} = require('../services/auth-phone.service');

const sendError = (res, status, message, error) => {
  return res.status(status).json({
    message,
    error,
  });
};

const PASSWORD_SALT_ROUNDS = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NICKNAME_PATTERN = /^[가-힣A-Za-z0-9]{2,12}$/u;
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const ALLOWED_SIGNUP_ROLES = new Set(['USER', 'BREWERY_PENDING']);
const PASSWORD_RESET_EXPIRES_IN_MINUTES = 5;
const DEFAULT_KAKAO_APP_REDIRECT_URI = 'judamfrontend://kakao/callback';

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
  marketingAgreed: Boolean(user.marketing_agreed),
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

const buildKakaoAuthUrl = (redirectUri, state) => {
  const kakaoAuthUrl = new URL('https://kauth.kakao.com/oauth/authorize');
  kakaoAuthUrl.searchParams.set('response_type', 'code');
  kakaoAuthUrl.searchParams.set('client_id', process.env.KAKAO_REST_API_KEY);
  // redirectUri는 카카오 개발자 콘솔에 등록된 값만 정상 동작한다.
  kakaoAuthUrl.searchParams.set('redirect_uri', redirectUri);
  if (state) {
    kakaoAuthUrl.searchParams.set('state', state);
  }

  return kakaoAuthUrl.toString();
};

const encodeKakaoState = ({ appRedirectUri, state }) => {
  const payload = {};

  if (appRedirectUri) {
    payload.appRedirectUri = appRedirectUri;
  }

  if (state) {
    payload.state = state;
  }

  if (Object.keys(payload).length === 0) {
    return null;
  }

  return Buffer.from(JSON.stringify(payload)).toString('base64url');
};

const getAppRedirectUriFromState = (state) => {
  if (typeof state !== 'string' || !state.trim()) {
    return null;
  }

  try {
    const parsedState = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    return normalizeString(parsedState?.appRedirectUri) || null;
  } catch (error) {
    return null;
  }
};

const getKakaoCallbackRedirectUri = (state) => (
  getAppRedirectUriFromState(state)
  || process.env.KAKAO_APP_REDIRECT_URI
  || DEFAULT_KAKAO_APP_REDIRECT_URI
);

const appendQueryParams = (baseUrl, params) => {
  const url = new URL(baseUrl);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  });

  return url.toString();
};

const generatePasswordResetCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

const sendPasswordResetEmail = async () => {
  // MVP에서는 이메일 발송 대신 응답에 인증번호를 포함한다.
};

const checkEmail = async (req, res) => {
  const email = normalizeString(req.query?.email).toLowerCase();

  if (!email) {
    return res.status(400).json({
      status: 400,
      message: '이메일을 입력해주세요.',
    });
  }

  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({
      status: 400,
      message: '이메일 형식이 올바르지 않습니다.',
    });
  }

  try {
    const existingUser = await findUserByEmail(email);
    const isAvailable = !existingUser;

    return res.status(200).json({
      status: 200,
      message: isAvailable ? '사용 가능한 이메일입니다.' : '이미 사용 중인 이메일입니다.',
      data: {
        email,
        isAvailable,
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '이메일 중복 확인 중 서버 오류가 발생했습니다.',
    });
  }
};

const checkNickname = async (req, res) => {
  const nickname = normalizeString(req.query?.nickname);

  if (!nickname) {
    return res.status(400).json({
      status: 400,
      message: '닉네임을 입력해주세요.',
    });
  }

  if (!NICKNAME_PATTERN.test(nickname)) {
    return res.status(400).json({
      status: 400,
      message: '닉네임은 2자 이상 12자 이하의 한글, 영문, 숫자만 사용할 수 있습니다.',
    });
  }

  try {
    const isAvailable = !(await isNicknameExists(nickname));

    return res.status(200).json({
      status: 200,
      message: isAvailable ? '사용 가능한 닉네임입니다.' : '이미 사용 중인 닉네임입니다.',
      data: {
        nickname,
        isAvailable,
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '닉네임 중복 확인 중 서버 오류가 발생했습니다.',
    });
  }
};

const signup = async (req, res) => {
  const email = normalizeString(req.body?.email).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const nickname = normalizeString(req.body?.nickname);
  let phoneNumber = req.body?.phoneNumber === undefined || req.body?.phoneNumber === null
    ? null
    : normalizeString(req.body.phoneNumber);
  const phoneVerificationToken = normalizeString(req.body?.phoneVerificationToken);
  const termsAgreed = req.body?.termsAgreed === true;
  const privacyAgreed = req.body?.privacyAgreed === true;
  const marketingAgreed = req.body?.marketingAgreed === true;
  const role = req.body?.role === undefined || req.body?.role === null || req.body?.role === ''
    ? 'USER'
    : normalizeString(req.body.role).toUpperCase();

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

  if (!PASSWORD_PATTERN.test(password)) {
    return res.status(400).json({
      status: 400,
      message: '비밀번호는 8자 이상이며 영문 대문자, 영문 소문자, 숫자를 모두 포함해야 합니다.',
    });
  }

  if (!NICKNAME_PATTERN.test(nickname)) {
    return res.status(400).json({
      status: 400,
      message: '닉네임은 2자 이상 12자 이하의 한글, 영문, 숫자만 사용할 수 있습니다.',
    });
  }

  if (!termsAgreed || !privacyAgreed) {
    return res.status(400).json({
      status: 400,
      message: '필수 약관에 동의해주세요.',
    });
  }

  if (!ALLOWED_SIGNUP_ROLES.has(role)) {
    return res.status(400).json({
      status: 400,
      message: '유효하지 않은 사용자 유형입니다.',
    });
  }

  if (phoneNumber === '') {
    phoneNumber = null;
  }

  try {
    if (phoneNumber) {
      const phoneVerification = await verifyAuthPhoneVerificationToken(phoneNumber, phoneVerificationToken);

      if (!phoneVerification.isValid) {
        return res.status(400).json({
          status: 400,
          message: '전화번호 인증이 필요합니다.',
        });
      }

      phoneNumber = phoneVerification.phoneNumber;
    }

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
      role,
      termsAgreed,
      privacyAgreed,
      marketingAgreed,
    });
    const accessToken = generateAccessToken(user);
    const refreshToken = await issueRefreshToken(user.user_id);
    const signupUser = mapSignupUserResponse(user);

    return res.status(201).json({
      status: 201,
      message: '회원가입 성공',
      data: {
        ...signupUser,
        accessToken,
        refreshToken,
        user: {
          ...mapLoginUserResponse(user),
          marketingAgreed: signupUser.marketingAgreed,
        },
      },
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

    if (error.statusCode === 400) {
      return res.status(400).json({
        status: 400,
        message: error.message,
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

const updateMyRole = async (req, res) => {
  const userId = req.user?.userId;
  const role = normalizeString(req.body?.role).toUpperCase();

  if (!userId) {
    return res.status(401).json({
      status: 401,
      message: '유효하지 않거나 만료된 토큰입니다.',
    });
  }

  if (!ALLOWED_SIGNUP_ROLES.has(role)) {
    return res.status(400).json({
      status: 400,
      message: '변경할 수 없는 사용자 유형입니다.',
    });
  }

  try {
    const user = await updateUserRole(userId, role);

    return res.status(200).json({
      status: 200,
      message: '사용자 유형 변경 성공',
      data: {
        user: mapLoginUserResponse(user),
      },
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        status: error.statusCode,
        message: error.message,
      });
    }

    return res.status(500).json({
      status: 500,
      message: '사용자 유형 변경 중 서버 오류가 발생했습니다.',
    });
  }
};

const requestAuthPhoneVerificationController = async (req, res) => {
  const phoneNumber = req.body?.phoneNumber;

  if (phoneNumber === undefined || phoneNumber === null || normalizeString(phoneNumber) === '') {
    return res.status(400).json({
      status: 400,
      message: '전화번호를 입력해주세요.',
    });
  }

  try {
    const data = await requestAuthPhoneVerification(phoneNumber);

    return res.status(200).json({
      status: 200,
      message: '전화번호 인증 요청이 생성되었습니다.',
      data,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      status: error.statusCode || 500,
      message: error.message || '전화번호 인증 요청 생성 중 서버 오류가 발생했습니다.',
    });
  }
};

const confirmAuthPhoneVerificationController = async (req, res) => {
  const phoneNumber = req.body?.phoneNumber;
  const verificationCode = normalizeString(req.body?.verificationCode);

  if (phoneNumber === undefined || phoneNumber === null || normalizeString(phoneNumber) === '') {
    return res.status(400).json({
      status: 400,
      message: '전화번호를 입력해주세요.',
    });
  }

  if (!verificationCode) {
    return res.status(400).json({
      status: 400,
      message: '인증번호를 입력해주세요.',
    });
  }

  try {
    const data = await confirmAuthPhoneVerification(phoneNumber, verificationCode);

    return res.status(200).json({
      status: 200,
      message: '전화번호 인증 성공',
      data,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      status: error.statusCode || 500,
      message: error.message || '전화번호 인증 확인 중 서버 오류가 발생했습니다.',
    });
  }
};

const requestPasswordReset = async (req, res) => {
  const email = normalizeString(req.body?.email).toLowerCase();

  if (!email) {
    return res.status(400).json({
      status: 400,
      message: '이메일을 입력해주세요.',
    });
  }

  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({
      status: 400,
      message: '이메일 형식이 올바르지 않습니다.',
    });
  }

  try {
    const user = await findUserByEmail(email);

    if (!user) {
      return res.status(404).json({
        status: 404,
        message: '해당 이메일로 가입된 계정을 찾을 수 없습니다.',
      });
    }

    if (user.provider !== 'local') {
      return res.status(400).json({
        status: 400,
        message: '소셜 로그인 계정은 비밀번호를 재설정할 수 없습니다.',
      });
    }

    const verificationCode = generatePasswordResetCode();
    await createPasswordResetVerification(email, verificationCode);
    await sendPasswordResetEmail(email, verificationCode);

    return res.status(200).json({
      status: 200,
      message: '비밀번호 재설정 인증번호가 발급되었습니다.',
      data: {
        email,
        verificationCode,
        expiresInMinutes: PASSWORD_RESET_EXPIRES_IN_MINUTES,
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '비밀번호 재설정 인증번호 발급 중 서버 오류가 발생했습니다.',
    });
  }
};

const verifyPasswordReset = async (req, res) => {
  const email = normalizeString(req.body?.email).toLowerCase();
  const verificationCode = normalizeString(req.body?.verificationCode);

  if (!email) {
    return res.status(400).json({
      status: 400,
      message: '이메일을 입력해주세요.',
    });
  }

  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({
      status: 400,
      message: '이메일 형식이 올바르지 않습니다.',
    });
  }

  if (!verificationCode) {
    return res.status(400).json({
      status: 400,
      message: '인증번호가 올바르지 않거나 만료되었습니다.',
    });
  }

  try {
    const verification = await verifyPasswordResetVerification(email, verificationCode);

    if (!verification) {
      return res.status(400).json({
        status: 400,
        message: '인증번호가 올바르지 않거나 만료되었습니다.',
      });
    }

    return res.status(200).json({
      status: 200,
      message: '인증번호 확인 성공',
      data: {
        email,
        verified: true,
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '인증번호 확인 중 서버 오류가 발생했습니다.',
    });
  }
};

const resetPassword = async (req, res) => {
  const email = normalizeString(req.body?.email).toLowerCase();
  const verificationCode = normalizeString(req.body?.verificationCode);
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  const newPasswordConfirm = typeof req.body?.newPasswordConfirm === 'string'
    ? req.body.newPasswordConfirm
    : '';

  if (!email) {
    return res.status(400).json({
      status: 400,
      message: '이메일을 입력해주세요.',
    });
  }

  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({
      status: 400,
      message: '이메일 형식이 올바르지 않습니다.',
    });
  }

  if (!verificationCode) {
    return res.status(400).json({
      status: 400,
      message: '인증번호 확인이 필요합니다.',
    });
  }

  if (newPassword !== newPasswordConfirm) {
    return res.status(400).json({
      status: 400,
      message: '새 비밀번호와 비밀번호 확인이 일치하지 않습니다.',
    });
  }

  if (!PASSWORD_PATTERN.test(newPassword)) {
    return res.status(400).json({
      status: 400,
      message: '비밀번호는 8자 이상이며 영문 대문자, 영문 소문자, 숫자를 모두 포함해야 합니다.',
    });
  }

  try {
    const user = await findUserByEmail(email);

    if (!user) {
      return res.status(404).json({
        status: 404,
        message: '해당 이메일로 가입된 계정을 찾을 수 없습니다.',
      });
    }

    if (user.provider !== 'local') {
      return res.status(400).json({
        status: 400,
        message: '소셜 로그인 계정은 비밀번호를 재설정할 수 없습니다.',
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);
    await resetPasswordWithVerification(email, verificationCode, passwordHash);

    return res.status(200).json({
      status: 200,
      message: '비밀번호 재설정 성공',
    });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({
        status: 400,
        message: error.message,
      });
    }

    return res.status(500).json({
      status: 500,
      message: '비밀번호 재설정 중 서버 오류가 발생했습니다.',
    });
  }
};

const kakaoLoginUrl = (req, res) => {
  const redirectUri = normalizeString(req.query?.redirectUri) || getFrontendRedirectUri() || getBackendRedirectUri();
  const appRedirectUri = normalizeString(req.query?.appRedirectUri)
    || process.env.KAKAO_APP_REDIRECT_URI
    || DEFAULT_KAKAO_APP_REDIRECT_URI;
  const state = encodeKakaoState({
    appRedirectUri,
    state: normalizeString(req.query?.state),
  });

  if (!process.env.KAKAO_REST_API_KEY || !redirectUri) {
    return res.status(500).json({
      status: 500,
      message: '서버 내부 오류',
    });
  }

  const kakaoLoginUrlValue = buildKakaoAuthUrl(redirectUri, state);

  return res.status(200).json({
    status: 200,
    message: '카카오 로그인 URL 조회 성공',
    data: {
      kakaoLoginUrl: kakaoLoginUrlValue,
      url: kakaoLoginUrlValue,
      redirectUri,
      appRedirectUri,
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
  const { code, state, error, error_description: errorDescription } = req.query;
  const appRedirectUri = getKakaoCallbackRedirectUri(state);

  if (error) {
    return res.redirect(appendQueryParams(appRedirectUri, {
      error,
      errorDescription,
    }));
  }

  if (!code) {
    return res.redirect(appendQueryParams(appRedirectUri, {
      error: 'missing_code',
    }));
  }

  return res.redirect(appendQueryParams(appRedirectUri, { code }));
};

const getExistingKakaoUser = async (kakaoProfile) => {
  const kakaoUser = await findUserByKakaoId(kakaoProfile.kakaoId);

  if (kakaoUser) {
    return kakaoUser;
  }

  if (!kakaoProfile.email) {
    return null;
  }

  return findUserByEmail(kakaoProfile.email);
};

const hasEmptyProfileValue = (value) => value === null
  || value === undefined
  || (typeof value === 'string' && value.trim() === '');

const isIncompleteKakaoUserProfile = (user) => (
  hasEmptyProfileValue(user?.email)
  || hasEmptyProfileValue(user?.phone_number ?? user?.phoneNumber)
);

const buildKakaoSignupProfile = (kakaoProfile, existingUser = null) => ({
  kakaoId: kakaoProfile.kakaoId,
  email: kakaoProfile.email || existingUser?.email || null,
  nickname: kakaoProfile.nickname || existingUser?.nickname || null,
  profileImage: kakaoProfile.profileImage || existingUser?.profile_image || null,
  ...(existingUser ? { existingUserId: existingUser.user_id } : {}),
});

const buildKakaoSignupRequiredData = (kakaoProfile, kakaoSignupToken, extraData = {}) => ({
  isNewUser: true,
  signupRequired: true,
  ...extraData,
  email: kakaoProfile.email,
  nickname: kakaoProfile.nickname,
  profileImage: kakaoProfile.profileImage,
  kakaoSignupToken,
  kakaoProfile: {
    kakaoId: String(kakaoProfile.kakaoId),
    email: kakaoProfile.email,
    nickname: kakaoProfile.nickname,
    profileImage: kakaoProfile.profileImage,
  },
});

const kakaoLoginByCode = async (req, res) => {
  const { code } = req.body || {};
  const redirectUri = normalizeString(req.body?.redirectUri) || getFrontendRedirectUri();

  if (!code) {
    return res.status(400).json({
      status: 400,
      message: '카카오 인가 코드가 필요합니다.',
    });
  }

  try {
    let tokenData;
    try {
      tokenData = await getKakaoToken(code, redirectUri);
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
    const existingUser = await getExistingKakaoUser(kakaoProfile);

    if (!existingUser) {
      const signupProfile = buildKakaoSignupProfile(kakaoProfile);
      const kakaoSignupToken = generateKakaoSignupToken(signupProfile);

      return res.status(200).json({
        status: 200,
        message: '카카오 회원가입 추가 정보가 필요합니다.',
        data: buildKakaoSignupRequiredData(signupProfile, kakaoSignupToken),
      });
    }

    if (isIncompleteKakaoUserProfile(existingUser)) {
      const signupProfile = buildKakaoSignupProfile(kakaoProfile, existingUser);
      const kakaoSignupToken = generateKakaoSignupToken(signupProfile);

      return res.status(200).json({
        status: 200,
        message: '카카오 회원가입 추가 정보가 필요합니다.',
        data: buildKakaoSignupRequiredData(signupProfile, kakaoSignupToken, {
          reason: 'INCOMPLETE_PROFILE',
          existingUserId: String(existingUser.user_id),
        }),
      });
    }

    const loggedInUser = await updateUserLastLogin(existingUser.user_id);
    const accessToken = generateAccessToken(loggedInUser);
    const refreshToken = await issueRefreshToken(loggedInUser.user_id);

    return res.status(200).json({
      status: 200,
      message: '카카오 로그인 성공',
      data: {
        isNewUser: false,
        signupRequired: false,
        accessToken,
        refreshToken,
        user: mapLoginUserResponse(loggedInUser),
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
};

const completeKakaoSignup = async (req, res) => {
  const kakaoSignupToken = normalizeString(req.body?.kakaoSignupToken);
  const requestedEmail = normalizeString(req.body?.email).toLowerCase();
  const nickname = normalizeString(req.body?.nickname);
  let phoneNumber = req.body?.phoneNumber === undefined || req.body?.phoneNumber === null
    ? null
    : normalizeString(req.body.phoneNumber);
  const phoneVerificationToken = normalizeString(req.body?.phoneVerificationToken);
  const termsAgreed = req.body?.termsAgreed === true;
  const privacyAgreed = req.body?.privacyAgreed === true;
  const marketingAgreed = req.body?.marketingAgreed === true;
  const role = req.body?.role === undefined || req.body?.role === null || req.body?.role === ''
    ? 'USER'
    : normalizeString(req.body.role).toUpperCase();

  if (!kakaoSignupToken) {
    return res.status(400).json({
      status: 400,
      message: '카카오 회원가입 토큰이 필요합니다.',
    });
  }

  if (!nickname) {
    return res.status(400).json({
      status: 400,
      message: '닉네임을 입력해주세요.',
    });
  }

  if (!NICKNAME_PATTERN.test(nickname)) {
    return res.status(400).json({
      status: 400,
      message: '닉네임은 2자 이상 12자 이하의 한글, 영문, 숫자만 사용할 수 있습니다.',
    });
  }

  if (!termsAgreed || !privacyAgreed) {
    return res.status(400).json({
      status: 400,
      message: '필수 약관에 동의해주세요.',
    });
  }

  if (!ALLOWED_SIGNUP_ROLES.has(role)) {
    return res.status(400).json({
      status: 400,
      message: '유효하지 않은 사용자 유형입니다.',
    });
  }

  if (phoneNumber === '') {
    phoneNumber = null;
  }

  try {
    const kakaoProfile = verifyKakaoSignupToken(kakaoSignupToken);
    const kakaoEmail = kakaoProfile.email ? normalizeString(kakaoProfile.email).toLowerCase() : '';
    const existingUserId = kakaoProfile.existingUserId ? String(kakaoProfile.existingUserId) : null;

    if (requestedEmail && requestedEmail !== kakaoEmail) {
      return res.status(400).json({
        status: 400,
        message: '카카오 이메일 정보가 일치하지 않습니다.',
      });
    }

    if (phoneNumber) {
      const phoneVerification = await verifyAuthPhoneVerificationToken(phoneNumber, phoneVerificationToken);

      if (!phoneVerification.isValid) {
        return res.status(400).json({
          status: 400,
          message: '전화번호 인증이 필요합니다.',
        });
      }

      phoneNumber = phoneVerification.phoneNumber;
    }

    const [existingKakaoUser, existingEmailUser, duplicatedNickname] = await Promise.all([
      findUserByKakaoId(kakaoProfile.kakaoId),
      kakaoProfile.email ? findUserByEmail(kakaoProfile.email) : Promise.resolve(null),
      existingUserId ? isNicknameUsedByAnotherUser(nickname, existingUserId) : isNicknameExists(nickname),
    ]);

    if (
      (
        existingKakaoUser
        && (!existingUserId || String(existingKakaoUser.user_id) !== existingUserId)
      )
      || (
        existingEmailUser
        && (!existingUserId || String(existingEmailUser.user_id) !== existingUserId)
      )
    ) {
      return res.status(409).json({
        status: 409,
        message: '이미 가입된 카카오 계정입니다.',
      });
    }

    if (duplicatedNickname) {
      return res.status(409).json({
        status: 409,
        message: '이미 사용 중인 닉네임입니다.',
      });
    }

    const userPayload = {
      kakaoId: kakaoProfile.kakaoId,
      email: kakaoProfile.email || null,
      nickname,
      phoneNumber,
      profileImage: kakaoProfile.profileImage || null,
      role,
      termsAgreed,
      privacyAgreed,
      marketingAgreed,
    };
    const user = existingUserId
      ? await updateKakaoUserProfileCompletion({
        ...userPayload,
        userId: existingUserId,
      })
      : await createKakaoUser(userPayload);
    const accessToken = generateAccessToken(user);
    const refreshToken = await issueRefreshToken(user.user_id);

    return res.status(201).json({
      status: 201,
      message: '카카오 회원가입 성공',
      data: {
        accessToken,
        refreshToken,
        user: {
          ...mapLoginUserResponse(user),
          marketingAgreed: Boolean(user.marketing_agreed),
        },
      },
    });
  } catch (error) {
    if (error.statusCode === 401) {
      return res.status(400).json({
        status: 400,
        message: '카카오 회원가입 정보가 유효하지 않습니다.',
      });
    }

    if (error.statusCode === 400) {
      return res.status(400).json({
        status: 400,
        message: error.message,
      });
    }

    if (error.code === '23505') {
      return res.status(409).json({
        status: 409,
        message: '이미 가입된 카카오 계정입니다.',
      });
    }

    return res.status(500).json({
      status: 500,
      message: '카카오 회원가입 중 서버 오류가 발생했습니다.',
    });
  }
};

const refreshAccessToken = async (req, res) => {
  const { refreshToken } = req.body || {};

  if (!refreshToken) {
    return res.status(401).json({
      status: 401,
      message: '유효하지 않거나 만료된 리프레시 토큰입니다.',
    });
  }

  try {
    const accessToken = await refreshAccessTokenService(refreshToken);

    return res.status(200).json({
      status: 200,
      message: '토큰 재발급 성공',
      data: {
        accessToken,
      },
    });
  } catch (error) {
    if (error.statusCode === 401) {
      return res.status(401).json({
        status: 401,
        message: '유효하지 않거나 만료된 리프레시 토큰입니다.',
      });
    }

    return res.status(500).json({
      status: 500,
      message: '토큰 재발급 중 서버 오류가 발생했습니다.',
    });
  }
};

const logout = async (req, res) => {
  const { refreshToken } = req.body || {};

  try {
    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    }

    return res.status(200).json({
      status: 200,
      message: '로그아웃 성공',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '로그아웃 중 서버 오류가 발생했습니다.',
    });
  }
};

module.exports = {
  checkEmail,
  checkNickname,
  signup,
  login,
  updateMyRole,
  requestAuthPhoneVerificationController,
  confirmAuthPhoneVerificationController,
  requestPasswordReset,
  verifyPasswordReset,
  resetPassword,
  kakaoLoginUrl,
  kakaoLogin,
  kakaoCallback,
  kakaoLoginByCode,
  completeKakaoSignup,
  refreshAccessToken,
  logout,
};
