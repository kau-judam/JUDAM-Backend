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
const {
  PASSWORD_RESET_EXPIRES_IN_MINUTES,
  requestPasswordResetVerification,
  verifyPasswordResetCode,
  confirmPasswordReset,
} = require('../services/auth.service');

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
  kakaoAuthUrl.searchParams.set('scope', 'account_email profile_nickname profile_image');
  // redirectUri??移댁뭅??媛쒕컻??肄섏넄???깅줉??媛믩쭔 ?뺤긽 ?숈옉?쒕떎.
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


const checkEmail = async (req, res) => {
  const email = normalizeString(req.query?.email).toLowerCase();

  if (!email) {
    return res.status(400).json({
      status: 400,
      message: '?대찓?쇱쓣 ?낅젰?댁＜?몄슂.',
    });
  }

  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({
      status: 400,
      message: '?대찓???뺤떇???щ컮瑜댁? ?딆뒿?덈떎.',
    });
  }

  try {
    const existingUser = await findUserByEmail(email);
    const isAvailable = !existingUser;

    return res.status(200).json({
      status: 200,
      message: isAvailable ? '?ъ슜 媛?ν븳 ?대찓?쇱엯?덈떎.' : '?대? ?ъ슜 以묒씤 ?대찓?쇱엯?덈떎.',
      data: {
        email,
        isAvailable,
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '?대찓??以묐났 ?뺤씤 以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
    });
  }
};

const checkNickname = async (req, res) => {
  const nickname = normalizeString(req.query?.nickname);

  if (!nickname) {
    return res.status(400).json({
      status: 400,
      message: '?됰꽕?꾩쓣 ?낅젰?댁＜?몄슂.',
    });
  }

  if (!NICKNAME_PATTERN.test(nickname)) {
    return res.status(400).json({
      status: 400,
      message: '?됰꽕?꾩? 2???댁긽 12???댄븯???쒓?, ?곷Ц, ?レ옄留??ъ슜?????덉뒿?덈떎.',
    });
  }

  try {
    const isAvailable = !(await isNicknameExists(nickname));

    return res.status(200).json({
      status: 200,
      message: isAvailable ? '?ъ슜 媛?ν븳 ?됰꽕?꾩엯?덈떎.' : '?대? ?ъ슜 以묒씤 ?됰꽕?꾩엯?덈떎.',
      data: {
        nickname,
        isAvailable,
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '?됰꽕??以묐났 ?뺤씤 以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
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
      message: 'email, password, nickname? ?꾩닔?낅땲??',
    });
  }

  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({
      status: 400,
      message: '?대찓???뺤떇???щ컮瑜댁? ?딆뒿?덈떎.',
    });
  }

  if (!PASSWORD_PATTERN.test(password)) {
    return res.status(400).json({
      status: 400,
      message: '鍮꾨?踰덊샇??8???댁긽?대ŉ ?곷Ц ?臾몄옄, ?곷Ц ?뚮Ц?? ?レ옄瑜?紐⑤몢 ?ы븿?댁빞 ?⑸땲??',
    });
  }

  if (!NICKNAME_PATTERN.test(nickname)) {
    return res.status(400).json({
      status: 400,
      message: '?됰꽕?꾩? 2???댁긽 12???댄븯???쒓?, ?곷Ц, ?レ옄留??ъ슜?????덉뒿?덈떎.',
    });
  }

  if (!termsAgreed || !privacyAgreed) {
    return res.status(400).json({
      status: 400,
      message: '?꾩닔 ?쎄????숈쓽?댁＜?몄슂.',
    });
  }

  if (!ALLOWED_SIGNUP_ROLES.has(role)) {
    return res.status(400).json({
      status: 400,
      message: '?좏슚?섏? ?딆? ?ъ슜???좏삎?낅땲??',
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
          message: '?꾪솕踰덊샇 ?몄쬆???꾩슂?⑸땲??',
        });
      }

      phoneNumber = phoneVerification.phoneNumber;
    }

    const existingUser = await findUserByEmail(email);

    if (existingUser) {
      return res.status(409).json({
        status: 409,
        message: '?대? ?ъ슜 以묒씤 ?대찓?쇱엯?덈떎.',
      });
    }

    const duplicatedNickname = await isNicknameExists(nickname);

    if (duplicatedNickname) {
      return res.status(409).json({
        status: 409,
        message: '?대? ?ъ슜 以묒씤 ?됰꽕?꾩엯?덈떎.',
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
      message: '?뚯썝媛???깃났',
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
          message: '?대? ?ъ슜 以묒씤 ?대찓?쇱엯?덈떎.',
        });
      }

      const duplicatedNickname = await isNicknameExists(nickname);

      if (duplicatedNickname) {
        return res.status(409).json({
          status: 409,
          message: '?대? ?ъ슜 以묒씤 ?됰꽕?꾩엯?덈떎.',
        });
      }

      return res.status(409).json({
        status: 409,
        message: '?대? ?ъ슜 以묒씤 ?대찓?쇱엯?덈떎.',
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
      message: '?뚯썝媛??以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
    });
  }
};

const login = async (req, res) => {
  const email = normalizeString(req.body?.email).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!email || !password) {
    return res.status(400).json({
      status: 400,
      message: 'email, password???꾩닔?낅땲??',
    });
  }

  try {
    const user = await findUserByEmail(email);

    if (!user) {
      return res.status(401).json({
        status: 401,
        message: '?대찓???먮뒗 鍮꾨?踰덊샇媛 ?щ컮瑜댁? ?딆뒿?덈떎.',
      });
    }

    if (user.provider !== 'local') {
      return res.status(400).json({
        status: 400,
        message: '?뚯뀥 濡쒓렇?몄쑝濡?媛?낅맂 怨꾩젙?낅땲??',
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password || '');

    if (!isPasswordValid) {
      return res.status(401).json({
        status: 401,
        message: '?대찓???먮뒗 鍮꾨?踰덊샇媛 ?щ컮瑜댁? ?딆뒿?덈떎.',
      });
    }

    const loggedInUser = await updateLocalUserLastLogin(user.user_id);
    const accessToken = generateAccessToken(loggedInUser);
    const refreshToken = await issueRefreshToken(loggedInUser.user_id);

    return res.status(200).json({
      status: 200,
      message: '濡쒓렇???깃났',
      data: {
        accessToken,
        refreshToken,
        user: mapLoginUserResponse(loggedInUser),
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '濡쒓렇??以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
    });
  }
};

const updateMyRole = async (req, res) => {
  const userId = req.user?.userId;
  const role = normalizeString(req.body?.role).toUpperCase();

  if (!userId) {
    return res.status(401).json({
      status: 401,
      message: '?좏슚?섏? ?딄굅??留뚮즺???좏겙?낅땲??',
    });
  }

  if (!ALLOWED_SIGNUP_ROLES.has(role)) {
    return res.status(400).json({
      status: 400,
      message: '蹂寃쏀븷 ???녿뒗 ?ъ슜???좏삎?낅땲??',
    });
  }

  try {
    const user = await updateUserRole(userId, role);

    return res.status(200).json({
      status: 200,
      message: '?ъ슜???좏삎 蹂寃??깃났',
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
      message: '?ъ슜???좏삎 蹂寃?以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
    });
  }
};

const requestAuthPhoneVerificationController = async (req, res) => {
  const phoneNumber = req.body?.phoneNumber;

  if (phoneNumber === undefined || phoneNumber === null || normalizeString(phoneNumber) === '') {
    return res.status(400).json({
      status: 400,
      message: '?꾪솕踰덊샇瑜??낅젰?댁＜?몄슂.',
    });
  }

  try {
    const data = await requestAuthPhoneVerification(phoneNumber);

    return res.status(200).json({
      status: 200,
      message: '?꾪솕踰덊샇 ?몄쬆 ?붿껌???앹꽦?섏뿀?듬땲??',
      data,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      status: error.statusCode || 500,
      message: error.message || '?꾪솕踰덊샇 ?몄쬆 ?붿껌 ?앹꽦 以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
    });
  }
};

const confirmAuthPhoneVerificationController = async (req, res) => {
  const phoneNumber = req.body?.phoneNumber;
  const verificationCode = normalizeString(req.body?.verificationCode);

  if (phoneNumber === undefined || phoneNumber === null || normalizeString(phoneNumber) === '') {
    return res.status(400).json({
      status: 400,
      message: '?꾪솕踰덊샇瑜??낅젰?댁＜?몄슂.',
    });
  }

  if (!verificationCode) {
    return res.status(400).json({
      status: 400,
      message: '?몄쬆踰덊샇瑜??낅젰?댁＜?몄슂.',
    });
  }

  try {
    const data = await confirmAuthPhoneVerification(phoneNumber, verificationCode);

    return res.status(200).json({
      status: 200,
      message: '?꾪솕踰덊샇 ?몄쬆 ?깃났',
      data,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      status: error.statusCode || 500,
      message: error.message || '?꾪솕踰덊샇 ?몄쬆 ?뺤씤 以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
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
    await requestPasswordResetVerification(email);

    return res.status(200).json({
      status: 200,
      message: '비밀번호 재설정 인증번호가 이메일로 발송되었습니다.',
      data: {
        email,
        expiresInMinutes: PASSWORD_RESET_EXPIRES_IN_MINUTES,
      },
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;

    return res.status(statusCode).json({
      status: statusCode,
      message: error.message || '비밀번호 재설정 인증번호 발송 중 서버 오류가 발생했습니다.',
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

  if (!/^\d{6}$/.test(verificationCode)) {
    return res.status(400).json({
      status: 400,
      message: '인증번호가 올바르지 않거나 만료되었습니다.',
    });
  }

  try {
    const passwordReset = await verifyPasswordResetCode({ email, verificationCode });

    return res.status(200).json({
      status: 200,
      message: '인증번호 확인 성공',
      data: {
        passwordResetToken: passwordReset.passwordResetToken,
      },
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;

    return res.status(statusCode).json({
      status: statusCode,
      message: error.message || '인증번호 확인 중 서버 오류가 발생했습니다.',
    });
  }
};
const resetPassword = async (req, res) => {
  const passwordResetToken = normalizeString(req.body?.passwordResetToken);
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  const newPasswordConfirm = typeof req.body?.newPasswordConfirm === 'string'
    ? req.body.newPasswordConfirm
    : '';

  if (!passwordResetToken) {
    return res.status(400).json({
      status: 400,
      message: '비밀번호 재설정 토큰이 필요합니다.',
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
    await confirmPasswordReset({ passwordResetToken, newPassword });

    return res.status(200).json({
      status: 200,
      message: '비밀번호가 성공적으로 변경되었습니다.',
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;

    return res.status(statusCode).json({
      status: statusCode,
      message: error.message || '비밀번호 재설정 중 서버 오류가 발생했습니다.',
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
      message: '?쒕쾭 ?대? ?ㅻ쪟',
    });
  }

  const kakaoLoginUrlValue = buildKakaoAuthUrl(redirectUri, state);

  return res.status(200).json({
    status: 200,
    message: '移댁뭅??濡쒓렇??URL 議고쉶 ?깃났',
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

const sendKakaoEmailDuplicateResponse = (res, email, provider = 'local') => (
  res.status(409).json({
    status: 409,
    message: '以묐났???대찓?쇰줈 媛?낅맂 湲곕줉???덉뒿?덈떎.',
    data: {
      emailAlreadyExists: true,
      provider,
      email,
    },
  })
);

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
      message: '移댁뭅???멸? 肄붾뱶媛 ?꾩슂?⑸땲??',
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
        message: '移댁뭅???몄쬆???ㅽ뙣?덉뒿?덈떎.',
      });
    }

    let kakaoUserInfo;
    try {
      kakaoUserInfo = await getKakaoUserInfo(tokenData.access_token);
    } catch (error) {
      return res.status(502).json({
        status: 502,
        message: '移댁뭅???ъ슜???뺣낫 議고쉶???ㅽ뙣?덉뒿?덈떎.',
      });
    }

    const kakaoProfile = buildKakaoProfile(kakaoUserInfo);
    const existingUser = await getExistingKakaoUser(kakaoProfile);

    if (existingUser && existingUser.provider !== 'kakao') {
      return sendKakaoEmailDuplicateResponse(
        res,
        kakaoProfile.email || existingUser.email,
        existingUser.provider,
      );
    }

    if (!existingUser) {
      const signupProfile = buildKakaoSignupProfile(kakaoProfile);
      const kakaoSignupToken = generateKakaoSignupToken(signupProfile);

      return res.status(200).json({
        status: 200,
        message: '移댁뭅???뚯썝媛??異붽? ?뺣낫媛 ?꾩슂?⑸땲??',
        data: buildKakaoSignupRequiredData(signupProfile, kakaoSignupToken),
      });
    }

    if (isIncompleteKakaoUserProfile(existingUser)) {
      const signupProfile = buildKakaoSignupProfile(kakaoProfile, existingUser);
      const kakaoSignupToken = generateKakaoSignupToken(signupProfile);

      return res.status(200).json({
        status: 200,
        message: '移댁뭅???뚯썝媛??異붽? ?뺣낫媛 ?꾩슂?⑸땲??',
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
      message: '移댁뭅??濡쒓렇???깃났',
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
        message: '移댁뭅???몄쬆???ㅽ뙣?덉뒿?덈떎.',
      });
    }

    if (error.response?.config?.url?.includes('/v2/user/me')) {
      return res.status(502).json({
        status: 502,
        message: '移댁뭅???ъ슜???뺣낫 議고쉶???ㅽ뙣?덉뒿?덈떎.',
      });
    }

    return res.status(500).json({
      status: 500,
      message: '?쒕쾭 ?대? ?ㅻ쪟',
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
      message: '移댁뭅???뚯썝媛???좏겙???꾩슂?⑸땲??',
    });
  }

  if (!nickname) {
    return res.status(400).json({
      status: 400,
      message: '?됰꽕?꾩쓣 ?낅젰?댁＜?몄슂.',
    });
  }

  if (!NICKNAME_PATTERN.test(nickname)) {
    return res.status(400).json({
      status: 400,
      message: '?됰꽕?꾩? 2???댁긽 12???댄븯???쒓?, ?곷Ц, ?レ옄留??ъ슜?????덉뒿?덈떎.',
    });
  }

  if (!termsAgreed || !privacyAgreed) {
    return res.status(400).json({
      status: 400,
      message: '?꾩닔 ?쎄????숈쓽?댁＜?몄슂.',
    });
  }

  if (!ALLOWED_SIGNUP_ROLES.has(role)) {
    return res.status(400).json({
      status: 400,
      message: '?좏슚?섏? ?딆? ?ъ슜???좏삎?낅땲??',
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
        message: '移댁뭅???대찓???뺣낫媛 ?쇱튂?섏? ?딆뒿?덈떎.',
      });
    }

    if (phoneNumber) {
      const phoneVerification = await verifyAuthPhoneVerificationToken(phoneNumber, phoneVerificationToken);

      if (!phoneVerification.isValid) {
        return res.status(400).json({
          status: 400,
          message: '?꾪솕踰덊샇 ?몄쬆???꾩슂?⑸땲??',
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
        message: '?대? 媛?낅맂 移댁뭅??怨꾩젙?낅땲??',
      });
    }

    if (duplicatedNickname) {
      return res.status(409).json({
        status: 409,
        message: '?대? ?ъ슜 以묒씤 ?됰꽕?꾩엯?덈떎.',
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
      message: '移댁뭅???뚯썝媛???깃났',
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
        message: '移댁뭅???뚯썝媛???뺣낫媛 ?좏슚?섏? ?딆뒿?덈떎.',
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
        message: '?대? 媛?낅맂 移댁뭅??怨꾩젙?낅땲??',
      });
    }

    return res.status(500).json({
      status: 500,
      message: '移댁뭅???뚯썝媛??以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
    });
  }
};

const refreshAccessToken = async (req, res) => {
  const { refreshToken } = req.body || {};

  if (!refreshToken) {
    return res.status(401).json({
      status: 401,
      message: '?좏슚?섏? ?딄굅??留뚮즺??由ы봽?덉떆 ?좏겙?낅땲??',
    });
  }

  try {
    const accessToken = await refreshAccessTokenService(refreshToken);

    return res.status(200).json({
      status: 200,
      message: '?좏겙 ?щ컻湲??깃났',
      data: {
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    if (error.statusCode === 401) {
      return res.status(401).json({
        status: 401,
        message: '?좏슚?섏? ?딄굅??留뚮즺??由ы봽?덉떆 ?좏겙?낅땲??',
      });
    }

    return res.status(500).json({
      status: 500,
      message: '?좏겙 ?щ컻湲?以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
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
      message: '濡쒓렇?꾩썐 ?깃났',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '濡쒓렇?꾩썐 以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
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
