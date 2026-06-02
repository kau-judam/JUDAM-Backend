const bcrypt = require('bcrypt');
const axios = require('axios');
const {
  findUserById,
  updateUserProfile,
  isNicknameExists,
} = require('./user.service');
const { uploadFileToS3 } = require('./s3.service');
const { convertSurvey } = require('./aiSurvey.service');
const { updateAiTasteProfile } = require('./ai.service');
const pool = require('../config/db');

const createServiceError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const PASSWORD_SALT_ROUNDS = 10;
const DEFAULT_OCTOMO_API_URL = 'https://api.octoverse.kr/octomo/v1/public/message/exists';
const OCTOMO_API_URL = process.env.OCTOMO_API_URL
  || DEFAULT_OCTOMO_API_URL;
const OCTOMO_RECEIVE_NUMBER = process.env.OCTOMO_RECEIVE_NUMBER || '1666-3538';
const AI_TASTE_RATING_KEYS = [
  'sweetness',
  'body',
  'carbonation',
  'flavor',
  'alcohol',
  'acidity',
  'aroma_intensity',
  'finish',
];

const mapProfileResponse = (user) => ({
  userId: String(user.user_id),
  profileImageUrl: user.profile_image,
  nickname: user.nickname,
  phoneNumber: user.phone_number,
  email: user.email,
  loginType: user.provider,
});

const getExistingUser = async (userId) => {
  const user = await findUserById(userId);

  if (!user) {
    throw createServiceError(404, '?????? ?轅붽틓?????????????욱룏???????낆젵.');
  }

  return user;
};

const getMyProfile = async (userId) => {
  const user = await getExistingUser(userId);
  return mapProfileResponse(user);
};

const checkNickname = async (userId, nickname) => {
  const user = await getExistingUser(userId);

  if (user.nickname === nickname) {
    return {
      nickname,
      isAvailable: true,
    };
  }

  const exists = await isNicknameExists(nickname);

  return {
    nickname,
    isAvailable: !exists,
  };
};

const updateNickname = async (userId, nickname) => {
  const user = await updateUserProfile(userId, { nickname });

  return {
    nickname: user.nickname,
  };
};

const normalizePhoneNumber = (phoneNumber) => {
  if (typeof phoneNumber !== 'string') {
    throw createServiceError(400, '????袁ｋ쨨????브틦???살퓢?????꿔꺂??틝???놁뗄??????癲?? ???????????낆젵.');
  }

  const normalized = phoneNumber.replace(/\s/g, '').replace(/-/g, '');

  if (!/^010\d{7,8}$/.test(normalized)) {
    throw createServiceError(400, '????袁ｋ쨨????브틦???살퓢?????꿔꺂??틝???놁뗄??????癲?? ???????????낆젵.');
  }

  return normalized;
};

const generatePhoneVerificationCode = () => {
  const randomNumber = Math.floor(100000 + Math.random() * 900000);

  return `JUDAM${randomNumber}`;
};

const getOctomoMessageExistsUrl = () => {
  const trimmedUrl = (OCTOMO_API_URL || DEFAULT_OCTOMO_API_URL).trim().replace(/\/+$/, '');

  if (trimmedUrl.endsWith('/public/message/exists')) {
    return trimmedUrl;
  }

  if (trimmedUrl.endsWith('/public')) {
    return `${trimmedUrl}/message/exists`;
  }

  return `${trimmedUrl}/public/message/exists`;
};

const requestPhoneVerification = async (userId, phoneNumber) => {
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
  const verificationCode = generatePhoneVerificationCode();

  await pool.query(
    `
      INSERT INTO phone_verifications (
        user_id,
        phone_number,
        code,
        expires_at,
        created_at
      )
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '5 minutes', CURRENT_TIMESTAMP)
    `,
    [userId, normalizedPhoneNumber, verificationCode],
  );

  return {
    phoneNumber: normalizedPhoneNumber,
    verificationCode,
    sendTo: OCTOMO_RECEIVE_NUMBER,
    guideMessage: `?????????筌???????節덇덩?${verificationCode}??${OCTOMO_RECEIVE_NUMBER}?????ㅼ뒧????野????嚥싲갭횧????`,
  };
};

const checkOctomoMessageExists = async (phoneNumber, verificationCode) => {
  if (!process.env.OCTOMO_API_KEY) {
    throw createServiceError(500, '????袁ｋ쨨????브틦???살퓢?????꿔꺂????癒κ섶???癲ル슢怡??귦룈?????濚밸Ŧ?????????밸븶?④섣???癲???????');
  }

  const octomoMessageExistsUrl = getOctomoMessageExistsUrl();

  try {
    const response = await axios.post(
      octomoMessageExistsUrl,
      {
        mobileNum: phoneNumber,
        text: verificationCode,
      },
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Octomo ${process.env.OCTOMO_API_KEY}`,
        },
      },
    );

    return response.data?.verified === true || response.data?.exists === true;
  } catch (error) {
    console.error('Octomo API request failed', {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      data: error.response?.data,
      url: octomoMessageExistsUrl,
    });

    throw createServiceError(502, '????袁ｋ쨨????브틦???살퓢?????꿔꺂????癒κ섶???癲ル슢怡??귦룈??? ???癲?????????욱룏???????낆젵.');
  }
};

const updatePhoneNumberWithVerification = async (userId, phoneNumber, verificationCode) => {
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
  const normalizedVerificationCode = typeof verificationCode === 'string'
    ? verificationCode.trim()
    : '';

  const { rows } = await pool.query(
    `
      SELECT
        verification_id,
        user_id,
        phone_number,
        code
      FROM phone_verifications
      WHERE user_id = $1
        AND phone_number = $2
        AND code = $3
        AND verified_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [userId, normalizedPhoneNumber, normalizedVerificationCode],
  );
  const verification = rows[0];

  if (!verification) {
    throw createServiceError(400, '????袁ｋ쨨????브틦???살퓢?????꿔꺂????癒κ섶?????거?????????얜∥異???轅붽틓????鶯??癲???????');
  }

  const exists = await checkOctomoMessageExists(normalizedPhoneNumber, normalizedVerificationCode);

  if (!exists) {
    throw createServiceError(400, '??꿔꺂????癒κ섶????筌??????? ??꿔꺂??틝??????? ?????源낅돹??????');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `
        UPDATE phone_verifications
        SET verified_at = CURRENT_TIMESTAMP
        WHERE verification_id = $1
          AND verified_at IS NULL
      `,
      [verification.verification_id],
    );
    const { rows: userRows } = await client.query(
      `
        UPDATE users
        SET
          phone_number = $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $2
          AND deleted_at IS NULL
        RETURNING phone_number
      `,
      [normalizedPhoneNumber, userId],
    );

    if (userRows.length === 0) {
      throw createServiceError(404, '?????? ?轅붽틓?????????????욱룏???????낆젵.');
    }

    await client.query('COMMIT');

    return {
      phoneNumber: userRows[0].phone_number,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const updateProfileImage = async (userId, file) => {
  const profileImageUrl = await uploadFileToS3(
    file.buffer,
    file.originalname,
    file.mimetype,
    userId,
  );
  const user = await updateUserProfile(userId, { profileImage: profileImageUrl });

  return {
    profileImageUrl: user.profile_image,
  };
};

const changeMyPassword = async (userId, currentPassword, newPassword) => {
  const { rows } = await pool.query(
    `
      SELECT
        user_id,
        password,
        provider
      FROM users
      WHERE user_id = $1
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [userId],
  );
  const user = rows[0];

  if (!user) {
    throw createServiceError(404, '?????? ?轅붽틓?????????????욱룏???????낆젵.');
  }

  if (user.provider !== 'local') {
    throw createServiceError(400, '??????黎??筌????????????????嶺?????亦껋꼦裕㎩쳞????ㅼ뒧????β뼯援???????????욱룏???????낆젵.');
  }

  const isPasswordValid = await bcrypt.compare(currentPassword, user.password || '');

  if (!isPasswordValid) {
    throw createServiceError(401, '?????밸븶???????嶺?????????? ????癲?? ???????????낆젵.');
  }

  const passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);

  await pool.query(
    `
      UPDATE users
      SET
        password = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $2
        AND deleted_at IS NULL
    `,
    [passwordHash, userId],
  );
};

const getParticipatedFundingCount = async (userId) => {
  const { rows } = await pool.query(
    `
      SELECT COUNT(DISTINCT funding_id) AS count
      FROM orders
      WHERE user_id = $1
        AND order_status = 'PAID'
        AND funding_id IS NOT NULL
    `,
    [userId],
  );

  return Number(rows[0]?.count || 0);
};

const getArchiveCount = async (userId) => {
  const { rows } = await pool.query(
    `
      SELECT COUNT(*) AS count
      FROM user_archives
      WHERE user_id = $1
    `,
    [userId],
  );

  return Number(rows[0]?.count || 0);
};

const BADGES = [
  {
    badgeId: 'welcome',
    name: '주담에 오신 것을 환영합니다!',
    displayOrder: 1,
  },
  {
    badgeId: 'communicate',
    name: '소통을 시작한 전통주 친구',
    displayOrder: 2,
  },
  {
    badgeId: 'funding-beginner',
    name: '펀딩 입문자',
    displayOrder: 3,
  },
  {
    badgeId: 'funding-intermediate',
    name: '펀딩 애호가',
    displayOrder: 4,
  },
  {
    badgeId: 'funding-expert',
    name: '펀딩 전문가',
    displayOrder: 5,
  },
  {
    badgeId: 'co-creator',
    name: '함께 빚는 동료',
    displayOrder: 6,
  },
];
const evaluateBadgeConditions = async (userId) => {
  const [
    userRowsResult,
    postCountResult,
    fundingSupportCountResult,
    coCreatorCountResult,
  ] = await Promise.all([
    pool.query(
      `
        SELECT user_id
        FROM users
        WHERE user_id = $1
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [userId],
    ),
    pool.query(
      `
        SELECT COUNT(*) AS count
        FROM posts
        WHERE user_id = $1
      `,
      [userId],
    ),
    pool.query(
      `
        SELECT COUNT(*) AS count
        FROM orders
        WHERE user_id = $1
          AND order_status = 'PAID'
          AND funding_id IS NOT NULL
      `,
      [userId],
    ),
    pool.query(
      `
        SELECT COUNT(*) AS count
        FROM recipes
        WHERE user_id = $1
          AND (
            is_fundable = true
            OR status IN ('ADOPTED', 'SELECTED', 'FUNDED')
          )
      `,
      [userId],
    ),
  ]);

  const userExists = userRowsResult.rows.length > 0;
  const postCount = Number(postCountResult.rows[0]?.count || 0);
  const fundingSupportCount = Number(fundingSupportCountResult.rows[0]?.count || 0);
  const coCreatorCount = Number(coCreatorCountResult.rows[0]?.count || 0);
  const earnedBadgeIds = [];

  if (userExists) {
    earnedBadgeIds.push('welcome');
  }

  if (postCount >= 1) {
    earnedBadgeIds.push('communicate');
  }

  if (fundingSupportCount >= 1) {
    earnedBadgeIds.push('funding-beginner');
  }

  if (fundingSupportCount >= 5) {
    earnedBadgeIds.push('funding-intermediate');
  }

  if (fundingSupportCount >= 10) {
    earnedBadgeIds.push('funding-expert');
  }

  if (coCreatorCount >= 1) {
    earnedBadgeIds.push('co-creator');
  }

  return earnedBadgeIds;
};

const grantEarnedBadges = async (userId, earnedBadgeIds) => {
  if (!earnedBadgeIds || earnedBadgeIds.length === 0) {
    return;
  }

  await pool.query(
    `
      INSERT INTO user_badges (
        user_id,
        badge_id,
        earned_at
      )
      SELECT $1, unnest($2::text[]), CURRENT_TIMESTAMP
      ON CONFLICT (user_id, badge_id) DO NOTHING
    `,
    [userId, earnedBadgeIds],
  );
};

const getUserBadgeRows = async (userId) => {
  const { rows } = await pool.query(
    `
      SELECT
        badge_id,
        earned_at
      FROM user_badges
      WHERE user_id = $1
    `,
    [userId],
  );

  return rows;
};

const getMyBadges = async (userId) => {
  const earnedBadgeIds = await evaluateBadgeConditions(userId);
  await grantEarnedBadges(userId, earnedBadgeIds);

  const badgeRows = await getUserBadgeRows(userId);
  const earnedAtByBadgeId = new Map(
    badgeRows.map((row) => [row.badge_id, row.earned_at]),
  );

  return {
    badges: BADGES.map((badge) => {
      const earnedAt = earnedAtByBadgeId.get(badge.badgeId) || null;

      return {
        ...badge,
        earned: Boolean(earnedAt),
        earnedAt,
      };
    }),
  };
};

const getLatestSulbti = async (userId) => {
  const { rows } = await pool.query(
    `
      SELECT
        u.taste_vector,
        u.bti_code,
        u.character_name,
        u.alcohol_label,
        u.updated_at AS user_updated_at,
        r.result_id,
        r.created_at,
        t.type_code,
        t.type_name,
        t.description
      FROM users u
      LEFT JOIN LATERAL (
        SELECT
          result_id,
          type_id,
          created_at
        FROM sul_bti_results
        WHERE user_id = u.user_id
        ORDER BY created_at DESC
        LIMIT 1
      ) r ON TRUE
      LEFT JOIN sul_bti_types t ON r.type_id = t.type_id
      WHERE u.user_id = $1
        AND u.deleted_at IS NULL
      LIMIT 1
    `,
    [userId],
  );

  const latestResult = rows[0];

  const hasResult = Boolean(
    latestResult?.result_id
    || latestResult?.bti_code
    || latestResult?.character_name
    || latestResult?.alcohol_label
    || latestResult?.taste_vector,
  );

  if (!hasResult) {
    return {
      hasResult: false,
      type: null,
      title: null,
      summary: null,
      tags: [],
    };
  }

  const normalizedBtiCode = normalizeSulbtiBtiCode(latestResult.bti_code || latestResult.type_code);
  const characterName = latestResult.character_name || latestResult.type_name || null;
  const alcoholLabel = latestResult.alcohol_label || latestResult.description || null;

  return {
    hasResult: true,
    type: normalizedBtiCode,
    btiCode: normalizedBtiCode,
    title: characterName,
    description: alcoholLabel,
    summary: alcoholLabel,
    characterName,
    alcoholLabel,
    tags: [],
  };
};

const getMyPageSummary = async (userId) => {
  const [participatedFundingCount, archiveCount, sulbti] = await Promise.all([
    getParticipatedFundingCount(userId),
    getArchiveCount(userId),
    getLatestSulbti(userId),
  ]);

  return {
    participatedFundingCount,
    archiveCount,
    badgeCount: 0,
    sulbti,
  };
};

const getEmptySulbtiResponse = () => ({
  hasResult: false,
  type: null,
  title: null,
  description: null,
  scores: null,
  tasteVector: null,
  btiCode: null,
  characterName: null,
  alcoholLabel: null,
  tags: [],
  createdAt: null,
  updatedAt: null,
});

const normalizeSulbtiBtiCode = (btiCode) => {
  if (btiCode === undefined || btiCode === null) {
    return null;
  }

  const normalized = String(btiCode).trim();

  if (!normalized) {
    return null;
  }

  return normalized.length >= 5 ? normalized.slice(0, 4) : normalized;
};

const hasSulbtiScoreColumns = (row) => [
  'sweetness_score',
  'body_score',
  'carbonation_score',
  'flavor_score',
  'abv_score',
].every((field) => row[field] !== null && row[field] !== undefined);

const mapSulbtiResponse = (row) => {
  const scores = hasSulbtiScoreColumns(row)
    ? {
      sweetness: Number(row.sweetness_score),
      body: Number(row.body_score),
      carbonation: Number(row.carbonation_score),
      flavor: Number(row.flavor_score),
      abv: Number(row.abv_score),
    }
    : null;

  const normalizedType = normalizeSulbtiBtiCode(row.bti_code || row.type_code);
  const tasteVector = row.taste_vector || null;

  return {
    hasResult: true,
    type: normalizedType,
    title: row.character_name || row.type_name || null,
    description: row.alcohol_label || row.description || null,
    scores: scores || tasteVector,
    tasteVector,
    btiCode: normalizedType,
    characterName: row.character_name || row.type_name || null,
    alcoholLabel: row.alcohol_label || null,
    tags: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.user_updated_at || null,
  };
};

const findSulbtiTypeByCode = async (typeCode) => {
  const { rows } = await pool.query(
    `
      SELECT
        type_id,
        type_code,
        type_name,
        description
      FROM sul_bti_types
      WHERE type_code = $1
      LIMIT 1
    `,
    [typeCode],
  );

  return rows[0] || null;
};

const getMySulbti = async (userId) => {
  const { rows } = await pool.query(
    `
      SELECT
        u.taste_vector,
        u.bti_code,
        u.character_name,
        u.alcohol_label,
        u.updated_at AS user_updated_at,
        r.result_id,
        r.user_id,
        r.type_id,
        r.sweetness_score,
        r.body_score,
        r.carbonation_score,
        r.flavor_score,
        r.abv_score,
        r.created_at,
        r.updated_at,
        t.type_code,
        t.type_name,
        t.description
      FROM users u
      LEFT JOIN sul_bti_results r ON r.user_id = u.user_id
      LEFT JOIN sul_bti_types t ON r.type_id = t.type_id
      WHERE u.user_id = $1
        AND u.deleted_at IS NULL
      LIMIT 1
    `,
    [userId],
  );

  const row = rows[0];
  const hasResult = Boolean(
    row?.result_id
    || row?.bti_code
    || row?.character_name
    || row?.alcohol_label
    || row?.taste_vector,
  );

  if (!hasResult) {
    return getEmptySulbtiResponse();
  }

  return mapSulbtiResponse(row);
};

const validateSulbtiScore = (score) => (
  typeof score === 'number'
  && Number.isFinite(score)
  && Number.isInteger(score)
  && score >= 1
  && score <= 5
);

const validateSulbtiPayload = (payload) => {
  const typeCode = typeof payload?.type === 'string' ? payload.type.trim() : '';

  if (!typeCode) {
    throw createServiceError(400, '???耀??????援????????⑤챷竊????觀????꿔꺂?????');
  }

  const scores = {
    sweetnessScore: payload?.sweetnessScore,
    bodyScore: payload?.bodyScore,
    carbonationScore: payload?.carbonationScore,
    flavorScore: payload?.flavorScore,
    abvScore: payload?.abvScore,
  };

  const hasInvalidScore = Object.values(scores).some(
    (score) => !validateSulbtiScore(score),
  );

  if (hasInvalidScore) {
    throw createServiceError(400, '???耀???????1~5 ???????????????癲ル슢?????');
  }

  return {
    typeCode,
    ...scores,
  };
};

const SULBTI_SURVEY_QUESTION_KEYS = Array.from({ length: 25 }, (_, index) => `q${index + 1}`);
const SULBTI_SURVEY_MULTI_SCORE_KEYS = ['q24', 'q25'];
const SULBTI_SURVEY_FORMAT_ERROR_MESSAGE = '???耀???????? ??꿔꺂??틝???놁뗄??????癲?? ???????????낆젵.';

const hasSulbtiSurveyQuestionKeys = (payload) => (
  payload
  && typeof payload === 'object'
  && !Array.isArray(payload)
  && SULBTI_SURVEY_QUESTION_KEYS.some((key) => Object.prototype.hasOwnProperty.call(payload, key))
);

const isSurveyConvertPayload = (payload) => {
  if (Array.isArray(payload)) {
    return true;
  }

  if (!payload || typeof payload !== 'object') {
    return false;
  }

  if (payload.type !== undefined) {
    return false;
  }

  if (hasSulbtiSurveyQuestionKeys(payload)) {
    return true;
  }

  return Object.prototype.hasOwnProperty.call(payload, 'answers')
    || Object.prototype.hasOwnProperty.call(payload, 'surveyResponses')
    || Object.prototype.hasOwnProperty.call(payload, 'responses');
};

const normalizeSulbtiSurveyScore = (value) => {
  const score = typeof value === 'string' && value.trim() !== ''
    ? Number(value)
    : value;

  if (
    typeof score !== 'number'
    || !Number.isFinite(score)
    || !Number.isInteger(score)
    || score < 1
    || score > 5
  ) {
    throw createServiceError(400, SULBTI_SURVEY_FORMAT_ERROR_MESSAGE);
  }

  return score;
};

const normalizeSulbtiSurveyMultiScore = (value) => {
  const values = Array.isArray(value) ? value : [value];

  if (values.length === 0) {
    throw createServiceError(400, SULBTI_SURVEY_FORMAT_ERROR_MESSAGE);
  }

  return values.map(normalizeSulbtiSurveyScore);
};

const assertCompleteSulbtiSurveyAnswers = (normalizedPayload) => {
  const hasAllAnswers = SULBTI_SURVEY_QUESTION_KEYS.every(
    (key) => Object.prototype.hasOwnProperty.call(normalizedPayload, key),
  );

  if (!hasAllAnswers) {
    throw createServiceError(400, SULBTI_SURVEY_FORMAT_ERROR_MESSAGE);
  }
};

const normalizeSulbtiSurveyQuestionValue = (questionKey, value) => {
  if (SULBTI_SURVEY_MULTI_SCORE_KEYS.includes(questionKey)) {
    return normalizeSulbtiSurveyMultiScore(value);
  }

  return normalizeSulbtiSurveyScore(value);
};

const normalizeSulbtiSurveyAnswers = (payload) => {
  if (hasSulbtiSurveyQuestionKeys(payload)) {
    const normalizedPayload = SULBTI_SURVEY_QUESTION_KEYS.reduce((acc, key) => {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        acc[key] = normalizeSulbtiSurveyQuestionValue(key, payload[key]);
      }

      return acc;
    }, {});

    assertCompleteSulbtiSurveyAnswers(normalizedPayload);
    return normalizedPayload;
  }

  const answerItems = Array.isArray(payload)
    ? payload
    : payload?.answers || payload?.surveyResponses || payload?.responses;

  if (!Array.isArray(answerItems)) {
    throw createServiceError(400, SULBTI_SURVEY_FORMAT_ERROR_MESSAGE);
  }

  const normalizedPayload = {};

  answerItems.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const questionNumber = Number(item.questionId);

    if (!Number.isInteger(questionNumber) || questionNumber < 1 || questionNumber > 25) {
      return;
    }

    const questionKey = `q${questionNumber}`;
    const answerValue = Object.prototype.hasOwnProperty.call(item, 'score')
      ? item.score
      : item.answer;

    normalizedPayload[questionKey] = normalizeSulbtiSurveyQuestionValue(questionKey, answerValue);
  });

  assertCompleteSulbtiSurveyAnswers(normalizedPayload);
  return normalizedPayload;
};

const extractSulbtiSurveyResult = (aiResponse) => {
  const result = aiResponse?.data || aiResponse?.result || aiResponse || {};
  const tasteVector = result.taste_vector || result.tasteVector;
  const btiCode = normalizeSulbtiBtiCode(result.bti_code || result.btiCode);
  const characterName = result.character_name || result.characterName;
  const alcoholLabel = result.alcohol_label || result.alcoholLabel;

  if (!tasteVector || !btiCode || !characterName || !alcoholLabel) {
    throw createServiceError(502, 'AI ???耀????ㅼ뒧??????β뼯援?????筌믨퀣?? ????癲?? ???????????낆젵.');
  }

  return {
    tasteVector,
    btiCode,
    characterName,
    alcoholLabel,
  };
};

const mapSulbtiSurveySaveResponse = (row) => {
  const normalizedBtiCode = normalizeSulbtiBtiCode(row.bti_code);
  const tasteVector = row.taste_vector || null;

  return {
    hasResult: true,
    type: normalizedBtiCode,
    title: row.character_name || null,
    description: row.alcohol_label || null,
    scores: tasteVector,
    tasteVector,
    btiCode: normalizedBtiCode,
    characterName: row.character_name,
    alcoholLabel: row.alcohol_label,
  };
};

const saveSulbtiSurveyResult = async (userId, surveyResult) => {
  const { rows } = await pool.query(
    `
      UPDATE users
      SET
        taste_vector = $1::jsonb,
        bti_code = $2,
        character_name = $3,
        alcohol_label = $4,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $5
        AND deleted_at IS NULL
      RETURNING
        taste_vector,
        bti_code,
        character_name,
        alcohol_label
    `,
    [
      JSON.stringify(surveyResult.tasteVector),
      surveyResult.btiCode,
      surveyResult.characterName,
      surveyResult.alcoholLabel,
      userId,
    ],
  );

  if (rows.length === 0) {
    throw createServiceError(404, '?????? ?轅붽틓?????????????욱룏???????낆젵.');
  }

  return mapSulbtiSurveySaveResponse(rows[0]);
};

const convertAndSaveMySulbtiSurvey = async (userId, payload) => {
  const normalizedPayload = normalizeSulbtiSurveyAnswers(payload);
  const aiResponse = await convertSurvey(normalizedPayload, userId);
  const surveyResult = extractSulbtiSurveyResult(aiResponse);

  return saveSulbtiSurveyResult(userId, surveyResult);
};


const getMySulbtiShareLink = async (userId) => {
  const sulbti = await getMySulbti(userId);

  if (!sulbti.hasResult) {
    const error = new Error('\uc220BTI \uacb0\uacfc\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.');
    error.statusCode = 404;
    throw error;
  }

  return sulbti;
};
const saveMySulbti = async (userId, payload) => {
  if (isSurveyConvertPayload(payload)) {
    return convertAndSaveMySulbtiSurvey(userId, payload);
  }

  const {
    typeCode,
    sweetnessScore,
    bodyScore,
    carbonationScore,
    flavorScore,
    abvScore,
  } = validateSulbtiPayload(payload);

  const sulbtiType = await findSulbtiTypeByCode(typeCode);

  if (!sulbtiType) {
    throw createServiceError(400, '?????援???? ??? ???耀??????援???????뽯쨦??');
  }

  const { rows } = await pool.query(
    `
      INSERT INTO sul_bti_results (
        user_id,
        type_id,
        sweetness_score,
        body_score,
        carbonation_score,
        flavor_score,
        abv_score,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id)
      DO UPDATE SET
        type_id = EXCLUDED.type_id,
        sweetness_score = EXCLUDED.sweetness_score,
        body_score = EXCLUDED.body_score,
        carbonation_score = EXCLUDED.carbonation_score,
        flavor_score = EXCLUDED.flavor_score,
        abv_score = EXCLUDED.abv_score,
        updated_at = CURRENT_TIMESTAMP
      RETURNING
        result_id,
        user_id,
        type_id,
        sweetness_score,
        body_score,
        carbonation_score,
        flavor_score,
        abv_score,
        created_at,
        updated_at
    `,
    [
      userId,
      sulbtiType.type_id,
      sweetnessScore,
      bodyScore,
      carbonationScore,
      flavorScore,
      abvScore,
    ],
  );

  return mapSulbtiResponse({
    ...rows[0],
    type_code: sulbtiType.type_code,
    type_name: sulbtiType.type_name,
    description: sulbtiType.description,
  });
};

const ARCHIVE_TYPES = new Set(['NORMAL', 'FUNDING']);
const ARCHIVE_QUERY_TYPES = {
  all: null,
  normal: 'NORMAL',
  funding: 'FUNDING',
};
const ARCHIVE_TAG_CATEGORY_NAMES = {
  TASTE: '맛',
  AROMA: '향',
  SITUATION: '상황',
  MOOD: '분위기',
};

const FIXED_ARCHIVE_TAG_GROUPS = [
  {
    category: 'TASTE',
    categoryName: '맛',
    tags: ['달콤한', '상큼한', '고소한', '깔끔한', '진한', '부드러운', '쌉싸름한', '묵직한', '산뜻한', '담백한'],
  },
  {
    category: 'AROMA',
    categoryName: '향',
    tags: ['꽃향', '과일향', '곡물향', '허브향', '누룩향', '은은한 향'],
  },
  {
    category: 'SITUATION',
    categoryName: '상황',
    tags: ['혼술', '친구 모임', '가족 식사', '기념일', '캠핑', '선물용', '퇴근 후', '가볍게'],
  },
  {
    category: 'MOOD',
    categoryName: '분위기',
    tags: ['차분한', '활기찬', '따뜻한', '특별한', '편안한', '로맨틱한'],
  },
];
const FIXED_ARCHIVE_TAG_ROWS = FIXED_ARCHIVE_TAG_GROUPS.flatMap((group, groupIndex) => (
  group.tags.map((name, tagIndex) => ({
    category: group.category,
    name,
    categoryOrder: groupIndex + 1,
    tagOrder: tagIndex + 1,
  }))
));

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

const toNullableNumber = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  return Number(value);
};

const formatDateOnly = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  return String(value);
};

const mapTagResponse = (row) => ({
  tagId: Number(row.tag_id),
  category: row.category,
  name: row.name,
});

const mapImageResponse = (row) => ({
  imageId: Number(row.image_id),
  imageUrl: row.image_url,
  sortOrder: toNullableNumber(row.sort_order),
});

const mapArchiveImageResponse = (row) => ({
  imageId: Number(row.image_id),
  imageUrl: row.image_url,
  sortOrder: toNullableNumber(row.sort_order),
});

const mapArchiveResponse = (row, tags = [], images = []) => ({
  archiveId: Number(row.archive_id),
  archiveType: row.archive_type,
  alcoholId: row.alcohol_id === null ? null : Number(row.alcohol_id),
  fundingId: row.funding_id === null ? null : Number(row.funding_id),
  orderId: row.order_id === null ? null : Number(row.order_id),
  reviewId: row.review_id === null ? null : Number(row.review_id),
  drinkName: row.drink_name,
  category: row.category,
  abv: toNullableNumber(row.abv),
  rating: toNullableNumber(row.rating),
  tastingNote: row.tasting_note,
  recordDate: formatDateOnly(row.record_date),
  mood: row.mood,
  pairing: row.pairing,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  tags,
  images,
});

const archiveSelectSql = `
  SELECT
    ua.archive_id,
    ua.user_id,
    ua.alcohol_id,
    ua.archive_type,
    ua.rating,
    ua.custom_name,
    ua.category,
    ua.abv,
    ua.tasting_note,
    ua.record_date,
    ua.mood,
    ua.pairing,
    ua.funding_id,
    ua.order_id,
    ua.review_id,
    ua.created_at,
    ua.updated_at,
    COALESCE(ua.custom_name, a.name) AS drink_name
  FROM user_archives ua
  LEFT JOIN alcohols a ON ua.alcohol_id = a.alcohol_id
`;

const parseNonNegativeInteger = (value, defaultValue, fieldName) => {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const stringValue = String(value);

  if (!/^\d+$/.test(stringValue)) {
    throw createServiceError(400, `${fieldName} ???ル봿????????癲?? ???????????낆젵.`);
  }

  return Number(stringValue);
};

const parseArchiveListQuery = (query = {}) => {
  const type = typeof query.type === 'string' && query.type.trim()
    ? query.type.trim().toLowerCase()
    : 'all';

  if (!hasOwn(ARCHIVE_QUERY_TYPES, type)) {
    throw createServiceError(400, '?????밸븶筌믡꺂?????????????ㅿ폑??????癲?? ???????????낆젵.');
  }

  const page = parseNonNegativeInteger(query.page, 0, 'page');
  const size = parseNonNegativeInteger(query.size, 10, 'size');

  if (size < 1) {
    throw createServiceError(400, 'size ???ル봿????????癲?? ???????????낆젵.');
  }

  return {
    archiveType: ARCHIVE_QUERY_TYPES[type],
    page,
    size,
    offset: page * size,
  };
};

const parseArchiveId = (archiveId) => {
  const stringValue = String(archiveId);

  if (!/^\d+$/.test(stringValue) || Number(stringValue) < 1) {
    throw createServiceError(400, '?????밸븶筌믡꺂??????ID???ル봿?? ????癲?? ???????????낆젵.');
  }

  return Number(stringValue);
};

const parseArchiveImageId = (imageId) => {
  const stringValue = String(imageId);

  if (!/^\d+$/.test(stringValue) || Number(stringValue) < 1) {
    throw createServiceError(400, '?????밸븶筌믡꺂???????????轅붽틓??? ID???ル봿?? ????癲?? ???????????낆젵.');
  }

  return Number(stringValue);
};

const groupRowsByArchiveId = (rows, mapper) => {
  const grouped = new Map();

  rows.forEach((row) => {
    const archiveId = String(row.archive_id);
    const items = grouped.get(archiveId) || [];
    items.push(mapper(row));
    grouped.set(archiveId, items);
  });

  return grouped;
};

const getTagsByArchiveIds = async (clientOrPool, archiveIds) => {
  if (archiveIds.length === 0) {
    return new Map();
  }

  const { rows } = await clientOrPool.query(
    `
      SELECT
        uat.archive_id,
        t.tag_id,
        t.category,
        t.name
      FROM user_archive_tags uat
      JOIN archive_tags t ON uat.tag_id = t.tag_id
      WHERE uat.archive_id = ANY($1::int[])
      ORDER BY uat.archive_id, t.category, t.tag_id
    `,
    [archiveIds],
  );

  return groupRowsByArchiveId(rows, mapTagResponse);
};

const getImagesByArchiveIds = async (clientOrPool, archiveIds) => {
  if (archiveIds.length === 0) {
    return new Map();
  }

  const { rows } = await clientOrPool.query(
    `
      SELECT
        image_id,
        archive_id,
        image_url,
        sort_order
      FROM user_archive_images
      WHERE archive_id = ANY($1::int[])
      ORDER BY archive_id, sort_order, image_id
    `,
    [archiveIds],
  );

  return groupRowsByArchiveId(rows, mapImageResponse);
};

const mapArchivesWithRelations = async (rows, clientOrPool = pool) => {
  const archiveIds = rows.map((row) => Number(row.archive_id));
  const [tagsByArchiveId, imagesByArchiveId] = await Promise.all([
    getTagsByArchiveIds(clientOrPool, archiveIds),
    getImagesByArchiveIds(clientOrPool, archiveIds),
  ]);

  return rows.map((row) => {
    const archiveId = String(row.archive_id);

    return mapArchiveResponse(
      row,
      tagsByArchiveId.get(archiveId) || [],
      imagesByArchiveId.get(archiveId) || [],
    );
  });
};

const findMyArchiveRow = async (clientOrPool, userId, archiveId) => {
  const { rows } = await clientOrPool.query(
    `
      ${archiveSelectSql}
      WHERE ua.archive_id = $1
        AND ua.user_id = $2
        AND ua.deleted_at IS NULL
      LIMIT 1
    `,
    [archiveId, userId],
  );

  return rows[0] || null;
};

const normalizeArchiveType = (archiveType, isPartial) => {
  if (archiveType === undefined && isPartial) {
    return undefined;
  }

  if (typeof archiveType !== 'string') {
    throw createServiceError(400, '?????밸븶筌믡꺂???????????援??? NORMAL ?????FUNDING?????ル봿????μ떝?롳쭗????????낆젵.');
  }

  const normalized = archiveType.trim().toUpperCase();

  if (!ARCHIVE_TYPES.has(normalized)) {
    throw createServiceError(400, '?????밸븶筌믡꺂???????????援??? NORMAL ?????FUNDING?????ル봿????μ떝?롳쭗????????낆젵.');
  }

  return normalized;
};

const normalizeOptionalString = (value, fieldName) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw createServiceError(400, `${fieldName} ???ル봿????????癲?? ???????????낆젵.`);
  }

  const trimmed = value.trim();
  return trimmed || null;
};

const normalizeOptionalNumber = (value, fieldName, min, max = null) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw createServiceError(400, `${fieldName} ???ル봿????????癲?? ???????????낆젵.`);
  }

  if (value < min || (max !== null && value > max)) {
    throw createServiceError(400, `${fieldName} ???ル봿????????癲?? ???????????낆젵.`);
  }

  return value;
};

const normalizeOptionalId = (value, fieldName) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw createServiceError(400, `${fieldName} ???ル봿????????癲?? ???????????낆젵.`);
  }

  return value;
};

const normalizeOptionalRecordDate = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createServiceError(400, '?????????덉땃??????댟? ??꿔꺂??틝???놁뗄??????癲?? ???????????낆젵.');
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw createServiceError(400, '?????????덉땃??????댟? ??꿔꺂??틝???놁뗄??????癲?? ???????????낆젵.');
  }

  return value;
};

const validateArchivePayload = (payload = {}, isPartial = false) => {
  const body = payload && typeof payload === 'object' ? payload : {};
  const validated = {};
  const archiveType = normalizeArchiveType(body.archiveType, isPartial);

  if (archiveType !== undefined) {
    validated.archiveType = archiveType;
  }

  const fieldNormalizers = {
    alcoholId: () => normalizeOptionalId(body.alcoholId, 'alcoholId'),
    customName: () => normalizeOptionalString(body.customName, 'customName'),
    category: () => normalizeOptionalString(body.category, 'category'),
    abv: () => normalizeOptionalNumber(body.abv, 'abv', 0),
    rating: () => normalizeOptionalNumber(body.rating, 'rating', 0, 5),
    tastingNote: () => normalizeOptionalString(body.tastingNote, 'tastingNote'),
    recordDate: () => normalizeOptionalRecordDate(body.recordDate),
    mood: () => normalizeOptionalString(body.mood, 'mood'),
    pairing: () => normalizeOptionalString(body.pairing, 'pairing'),
    fundingId: () => normalizeOptionalId(body.fundingId, 'fundingId'),
    orderId: () => normalizeOptionalId(body.orderId, 'orderId'),
    reviewId: () => normalizeOptionalId(body.reviewId, 'reviewId'),
  };

  Object.entries(fieldNormalizers).forEach(([fieldName, normalizer]) => {
    if (hasOwn(body, fieldName)) {
      validated[fieldName] = normalizer();
    }
  });

  if (hasOwn(body, 'tagIds')) {
    if (!Array.isArray(body.tagIds)) {
      throw createServiceError(400, 'tagIds????ш끽維뽳쭩?壤굿??뽯쑆?????욱룑?????癲ル슢?????');
    }

    validated.tagIds = body.tagIds;
  }

  if (hasOwn(body, 'customTags')) {
    validated.customTags = normalizeCustomTags(body.customTags);
  }

  if (!isPartial) {
    const customName = hasOwn(validated, 'customName') ? validated.customName : null;
    const alcoholId = hasOwn(validated, 'alcoholId') ? validated.alcoholId : null;

    if (!customName && alcoholId === null) {
      throw createServiceError(400, 'customName??alcoholId ?????棺堉?뤃管????????밸븶???癲ル슢?????');
    }
  }

  return validated;
};

const validateTagIds = async (clientOrPool, tagIds) => {
  if (tagIds === undefined) {
    return undefined;
  }

  const uniqueTagIds = [...new Set(tagIds)];

  if (
    uniqueTagIds.some(
      (tagId) => typeof tagId !== 'number' || !Number.isInteger(tagId) || tagId < 1,
    )
  ) {
    throw createServiceError(400, '?????援???? ??? ?????밸븶筌믡꺂?????????怨뚮뼺?源놁벀??????뽯쨦??');
  }

  if (uniqueTagIds.length === 0) {
    return [];
  }

  const { rows } = await clientOrPool.query(
    `
      SELECT tag_id
      FROM archive_tags
      WHERE tag_id = ANY($1::int[])
    `,
    [uniqueTagIds],
  );

  if (rows.length !== uniqueTagIds.length) {
    throw createServiceError(400, '?????援???? ??? ?????밸븶筌믡꺂?????????怨뚮뼺?源놁벀??????뽯쨦??');
  }

  return uniqueTagIds;
};

const normalizeCustomTags = (customTags) => {
  if (customTags === undefined) {
    return undefined;
  }

  if (customTags === null) {
    return [];
  }

  if (!Array.isArray(customTags)) {
    throw createServiceError(400, 'customTags????ш끽維뽳쭩?壤굿??뽯쑆?????욱룑?????癲ル슢?????');
  }

  return [...new Set(
    customTags
      .map((tagName) => (typeof tagName === 'string' ? tagName.trim() : ''))
      .filter(Boolean),
  )];
};

const findOrCreateCustomTagIds = async (clientOrPool, customTags) => {
  if (customTags === undefined) {
    return undefined;
  }

  if (customTags.length === 0) {
    return [];
  }

  const { rows: existingRows } = await clientOrPool.query(
    `
      SELECT tag_id, name
      FROM archive_tags
      WHERE category = 'CUSTOM'
        AND name = ANY($1::text[])
    `,
    [customTags],
  );
  const tagIdByName = new Map(
    existingRows.map((row) => [row.name, Number(row.tag_id)]),
  );

  for (const tagName of customTags) {
    if (!tagIdByName.has(tagName)) {
      const { rows } = await clientOrPool.query(
        `
          INSERT INTO archive_tags (
            category,
            name,
            created_at
          )
          VALUES ('CUSTOM', $1, CURRENT_TIMESTAMP)
          RETURNING tag_id
        `,
        [tagName],
      );
      tagIdByName.set(tagName, Number(rows[0].tag_id));
    }
  }

  return customTags.map((tagName) => tagIdByName.get(tagName));
};

const resolveArchiveTagIds = async (clientOrPool, tagIds, customTags) => {
  const validatedTagIds = await validateTagIds(clientOrPool, tagIds);
  const customTagIds = await findOrCreateCustomTagIds(clientOrPool, customTags);

  if (validatedTagIds === undefined && customTagIds === undefined) {
    return undefined;
  }

  return [...new Set([
    ...(validatedTagIds || []),
    ...(customTagIds || []),
  ])];
};

const ensureArchiveHasDrinkName = (archiveData, currentArchive = null) => {
  const customName = hasOwn(archiveData, 'customName')
    ? archiveData.customName
    : currentArchive?.custom_name || null;
  const alcoholId = hasOwn(archiveData, 'alcoholId')
    ? archiveData.alcoholId
    : currentArchive?.alcohol_id || null;

  if (!customName && alcoholId === null) {
    throw createServiceError(400, 'customName??alcoholId ?????棺堉?뤃管????????밸븶???癲ル슢?????');
  }
};

const insertArchiveTags = async (client, archiveId, tagIds) => {
  if (!tagIds || tagIds.length === 0) {
    return;
  }

  await client.query(
    `
      INSERT INTO user_archive_tags (
        archive_id,
        tag_id,
        created_at
      )
      SELECT $1, unnest($2::int[]), CURRENT_TIMESTAMP
    `,
    [archiveId, tagIds],
  );
};

const normalizeAiTasteNumber = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
};

const parseAiTasteRatingsSource = (ratings) => {
  if (!ratings) {
    return {};
  }

  if (typeof ratings === 'string') {
    try {
      const parsed = JSON.parse(ratings);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch (error) {
      return {};
    }
  }

  return typeof ratings === 'object' && !Array.isArray(ratings)
    ? ratings
    : {};
};

const extractAiTasteRatings = (payload = {}) => {
  const ratingsSource = parseAiTasteRatingsSource(payload.ratings);
  const ratings = {};

  AI_TASTE_RATING_KEYS.forEach((key) => {
    const value = hasOwn(payload, key)
      ? payload[key]
      : ratingsSource[key];
    const normalized = normalizeAiTasteNumber(value);

    if (normalized !== undefined) {
      ratings[key] = normalized;
    }
  });

  return ratings;
};

const normalizeAiTasteTags = (value) => {
  if (value === undefined || value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeAiTasteTags(item));
  }

  if (typeof value === 'object') {
    return normalizeAiTasteTags(value.name || value.tagName || value.label);
  }

  const stringValue = String(value).trim();

  if (!stringValue) {
    return [];
  }

  if (stringValue.startsWith('[')) {
    try {
      const parsed = JSON.parse(stringValue);
      return Array.isArray(parsed) ? normalizeAiTasteTags(parsed) : [];
    } catch (error) {
      return [stringValue];
    }
  }

  return stringValue
    .split(',')
    .map((tagName) => tagName.trim())
    .filter(Boolean);
};

const getArchiveAiTasteDrinkId = (archive) => {
  if (archive.alcoholId) return `alcohol_${archive.alcoholId}`;
  if (archive.fundingId) return `funding_${archive.fundingId}`;
  if (archive.archiveId) return `archive_${archive.archiveId}`;
  if (archive.reviewId) return `review_${archive.reviewId}`;
  return `custom_${Date.now()}`;
};

const buildArchiveAiTasteUpdatePayload = (userId, archive, sourcePayload = {}) => {
  const rating = normalizeAiTasteNumber(archive.rating);
  const ratings = extractAiTasteRatings(sourcePayload);

  if (rating === undefined && Object.keys(ratings).length === 0) {
    return null;
  }

  const tagNames = [
    ...normalizeAiTasteTags(archive.tags),
    ...normalizeAiTasteTags(sourcePayload.customTags),
    ...normalizeAiTasteTags(sourcePayload.tagNames),
    ...normalizeAiTasteTags(sourcePayload.tags),
  ];

  const aiPayload = {
    user_id: String(userId),
    drink_id: getArchiveAiTasteDrinkId(archive),
    tags: [...new Set(tagNames)],
  };

  if (rating !== undefined) {
    aiPayload.rating = rating;
  }

  if (Object.keys(ratings).length > 0) {
    aiPayload.ratings = ratings;
  }

  return aiPayload;
};

const shouldUpdateArchiveAiTaste = (archive, sourcePayload = {}, isCreate = false) => {
  if (Object.keys(extractAiTasteRatings(sourcePayload)).length > 0) {
    return true;
  }

  if (isCreate) {
    return normalizeAiTasteNumber(archive.rating) !== undefined;
  }

  return hasOwn(sourcePayload, 'rating')
    && normalizeAiTasteNumber(archive.rating) !== undefined;
};

const updateArchiveAiTasteProfile = async (userId, archive, sourcePayload = {}, isCreate = false) => {
  if (!shouldUpdateArchiveAiTaste(archive, sourcePayload, isCreate)) {
    return null;
  }

  const aiPayload = buildArchiveAiTasteUpdatePayload(userId, archive, sourcePayload);

  if (!aiPayload) {
    return null;
  }

  return updateAiTasteProfile(aiPayload);
};

const appendAiTasteUpdate = (archive, aiTasteUpdate) => (
  aiTasteUpdate
    ? { ...archive, aiTasteUpdate }
    : archive
);

const parseArchiveFormTagIds = (tagIds) => {
  if (tagIds === undefined) {
    return undefined;
  }

  if (Array.isArray(tagIds)) {
    return tagIds.flatMap((tagId) => parseArchiveFormTagIds(tagId) || []);
  }

  if (tagIds === null) {
    return [];
  }

  const stringValue = String(tagIds).trim();

  if (!stringValue) {
    return [];
  }

  if (stringValue.startsWith('[')) {
    try {
      const parsed = JSON.parse(stringValue);

      if (!Array.isArray(parsed)) {
        throw new Error('tagIds must be an array');
      }

      return parsed.map((tagId) => Number(tagId));
    } catch (error) {
      throw createServiceError(400, 'tagIds????ш끽維뽳쭩?壤굿??뽯쑆???꿔꺂??틝???놁뗄?????욱룑?????癲ル슢?????');
    }
  }

  return stringValue.split(',').map((tagId) => Number(tagId.trim()));
};

const parseArchiveFormCustomTags = (customTags) => {
  if (customTags === undefined) {
    return undefined;
  }

  if (Array.isArray(customTags)) {
    return normalizeCustomTags(
      customTags.flatMap((tagName) => parseArchiveFormCustomTags(tagName) || []),
    );
  }

  if (customTags === null) {
    return [];
  }

  const stringValue = String(customTags).trim();

  if (!stringValue) {
    return [];
  }

  if (stringValue.startsWith('[')) {
    try {
      const parsed = JSON.parse(stringValue);

      if (!Array.isArray(parsed)) {
        throw new Error('customTags must be an array');
      }

      return normalizeCustomTags(parsed);
    } catch (error) {
      throw createServiceError(400, 'customTags????ш끽維뽳쭩?壤굿??뽯쑆???꿔꺂??틝???놁뗄?????욱룑?????癲ル슢?????');
    }
  }

  return normalizeCustomTags(stringValue.split(','));
};

const normalizeArchiveDeleteImageIds = (deleteImageIds) => {
  if (deleteImageIds === undefined) {
    return undefined;
  }

  if (Array.isArray(deleteImageIds)) {
    return [...new Set(
      deleteImageIds.flatMap((imageId) => normalizeArchiveDeleteImageIds(imageId) || []),
    )];
  }

  if (deleteImageIds === null) {
    return [];
  }

  const stringValue = String(deleteImageIds).trim();

  if (!stringValue) {
    return [];
  }

  let parsedValues;

  if (stringValue.startsWith('[')) {
    try {
      const parsed = JSON.parse(stringValue);

      if (!Array.isArray(parsed)) {
        throw new Error('deleteImageIds must be an array');
      }

      parsedValues = parsed;
    } catch (error) {
      throw createServiceError(400, '?????밸븶筌믡꺂???????????轅붽틓??? ID???ル봿?? ????癲?? ???????????낆젵.');
    }
  } else {
    parsedValues = stringValue.split(',');
  }

  const imageIds = parsedValues.map((imageId) => Number(String(imageId).trim()));

  if (
    imageIds.some(
      (imageId) => !Number.isInteger(imageId) || imageId < 1,
    )
  ) {
    throw createServiceError(400, '?????밸븶筌믡꺂???????????轅붽틓??? ID???ル봿?? ????癲?? ???????????낆젵.');
  }

  return [...new Set(imageIds)];
};

const normalizeArchiveFormValue = (fieldName, value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const stringValue = String(value).trim();

  if (!stringValue) {
    return null;
  }

  if (
    fieldName === 'alcoholId'
    || fieldName === 'abv'
    || fieldName === 'rating'
    || fieldName === 'fundingId'
    || fieldName === 'orderId'
    || fieldName === 'reviewId'
  ) {
    return Number(stringValue);
  }

  return stringValue;
};

const normalizeArchiveFormPayload = (body = {}) => {
  const payload = {};
  const formFields = [
    'archiveType',
    'alcoholId',
    'customName',
    'category',
    'abv',
    'rating',
    'tastingNote',
    'recordDate',
    'mood',
    'pairing',
    'fundingId',
    'orderId',
    'reviewId',
  ];

  formFields.forEach((fieldName) => {
    if (hasOwn(body, fieldName)) {
      payload[fieldName] = normalizeArchiveFormValue(fieldName, body[fieldName]);
    }
  });

  if (hasOwn(body, 'tagIds')) {
    payload.tagIds = parseArchiveFormTagIds(body.tagIds);
  }

  if (hasOwn(body, 'customTags')) {
    payload.customTags = parseArchiveFormCustomTags(body.customTags);
  }

  return payload;
};

const getMyArchives = async (userId, query) => {
  const {
    archiveType,
    page,
    size,
    offset,
  } = parseArchiveListQuery(query);
  const whereClauses = ['ua.user_id = $1', 'ua.deleted_at IS NULL'];
  const filterValues = [userId];

  if (archiveType) {
    filterValues.push(archiveType);
    whereClauses.push(`ua.archive_type = $${filterValues.length}`);
  }

  const whereSql = whereClauses.join(' AND ');
  const [{ rows: countRows }, { rows: archiveRows }] = await Promise.all([
    pool.query(
      `
        SELECT COUNT(*) AS count
        FROM user_archives ua
        WHERE ${whereSql}
      `,
      filterValues,
    ),
    pool.query(
      `
        ${archiveSelectSql}
        WHERE ${whereSql}
        ORDER BY ua.created_at DESC
        LIMIT $${filterValues.length + 1}
        OFFSET $${filterValues.length + 2}
      `,
      [...filterValues, size, offset],
    ),
  ]);

  const totalElements = Number(countRows[0]?.count || 0);
  const data = await mapArchivesWithRelations(archiveRows);

  return {
    data,
    page,
    size,
    totalElements,
    totalPages: totalElements === 0 ? 0 : Math.ceil(totalElements / size),
  };
};

const getMyArchiveDetail = async (userId, archiveId) => {
  const parsedArchiveId = parseArchiveId(archiveId);
  const archiveRow = await findMyArchiveRow(pool, userId, parsedArchiveId);

  if (!archiveRow) {
    throw createServiceError(404, '?????밸븶筌믡꺂?????癲ル슢흮????轅붽틓?????????????욱룏???????낆젵.');
  }

  const [archive] = await mapArchivesWithRelations([archiveRow]);
  return archive;
};

const createMyArchive = async (userId, payload) => {
  const archiveData = validateArchivePayload(payload, false);
  ensureArchiveHasDrinkName(archiveData);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ??????FUNDING)?? ??????癲ル슢????1??????????????덉땃????ル봿???????????? ??? ?????⑤베???????????????덉땃?????濚밸Ŧ寃㎩쳞????μ떝?띄몭??袁㏉떄?????????轅붽틓?蹂잛젂?④낮釉???
    if (archiveData.archiveType === 'FUNDING' && archiveData.fundingId) {
      const { rows: existingFundingArchive } = await client.query(
        `
          SELECT 1
          FROM user_archives
          WHERE user_id = $1
            AND archive_type = 'FUNDING'
            AND funding_id = $2
            AND deleted_at IS NULL
          LIMIT 1
        `,
        [userId, archiveData.fundingId],
      );

      if (existingFundingArchive.length > 0) {
        throw createServiceError(400, '???? ?????????덉땃????????????????낆젵.');
      }
    }

    const tagIds = await resolveArchiveTagIds(
      client,
      archiveData.tagIds,
      archiveData.customTags,
    );
    const { rows } = await client.query(
      `
        INSERT INTO user_archives (
          user_id,
          alcohol_id,
          archive_type,
          rating,
          custom_name,
          category,
          abv,
          tasting_note,
          record_date,
          mood,
          pairing,
          funding_id,
          order_id,
          review_id,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        RETURNING archive_id
      `,
      [
        userId,
        archiveData.alcoholId ?? null,
        archiveData.archiveType,
        archiveData.rating ?? null,
        archiveData.customName ?? null,
        archiveData.category ?? null,
        archiveData.abv ?? null,
        archiveData.tastingNote ?? null,
        archiveData.recordDate ?? null,
        archiveData.mood ?? null,
        archiveData.pairing ?? null,
        archiveData.fundingId ?? null,
        archiveData.orderId ?? null,
        archiveData.reviewId ?? null,
      ],
    );

    const archiveId = Number(rows[0].archive_id);
    await insertArchiveTags(client, archiveId, tagIds);

    const archiveRow = await findMyArchiveRow(client, userId, archiveId);
    const [archive] = await mapArchivesWithRelations([archiveRow], client);

    await client.query('COMMIT');
    const aiTasteUpdate = await updateArchiveAiTasteProfile(userId, archive, payload, true);
    return appendAiTasteUpdate(archive, aiTasteUpdate);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const updateMyArchive = async (userId, archiveId, payload) => {
  const parsedArchiveId = parseArchiveId(archiveId);
  const archiveData = validateArchivePayload(payload, true);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const currentArchive = await findMyArchiveRow(client, userId, parsedArchiveId);

    if (!currentArchive) {
      throw createServiceError(404, '?????밸븶筌믡꺂?????癲ル슢흮????轅붽틓?????????????욱룏???????낆젵.');
    }

    ensureArchiveHasDrinkName(archiveData, currentArchive);

    const updateFields = [
      ['archiveType', 'archive_type'],
      ['alcoholId', 'alcohol_id'],
      ['customName', 'custom_name'],
      ['category', 'category'],
      ['abv', 'abv'],
      ['rating', 'rating'],
      ['tastingNote', 'tasting_note'],
      ['recordDate', 'record_date'],
      ['mood', 'mood'],
      ['pairing', 'pairing'],
      ['fundingId', 'funding_id'],
      ['orderId', 'order_id'],
      ['reviewId', 'review_id'],
    ];
    const setClauses = [];
    const values = [];

    updateFields.forEach(([fieldName, columnName]) => {
      if (hasOwn(archiveData, fieldName)) {
        values.push(archiveData[fieldName]);
        setClauses.push(`${columnName} = $${values.length}`);
      }
    });

    values.push(parsedArchiveId, userId);
    await client.query(
      `
        UPDATE user_archives
        SET
          ${setClauses.length > 0 ? `${setClauses.join(', ')},` : ''}
          updated_at = CURRENT_TIMESTAMP
        WHERE archive_id = $${values.length - 1}
          AND user_id = $${values.length}
          AND deleted_at IS NULL
      `,
      values,
    );

    if (hasOwn(archiveData, 'tagIds') || hasOwn(archiveData, 'customTags')) {
      const tagIds = await resolveArchiveTagIds(
        client,
        archiveData.tagIds,
        archiveData.customTags,
      );

      await client.query(
        `
          DELETE FROM user_archive_tags
          WHERE archive_id = $1
        `,
        [parsedArchiveId],
      );
      await insertArchiveTags(client, parsedArchiveId, tagIds);
    }

    const archiveRow = await findMyArchiveRow(client, userId, parsedArchiveId);
    const [archive] = await mapArchivesWithRelations([archiveRow], client);

    await client.query('COMMIT');
    const aiTasteUpdate = await updateArchiveAiTasteProfile(userId, archive, payload, false);
    return appendAiTasteUpdate(archive, aiTasteUpdate);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const deleteMyArchive = async (userId, archiveId) => {
  const parsedArchiveId = parseArchiveId(archiveId);
  const { rows } = await pool.query(
    `
      UPDATE user_archives
      SET
        deleted_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE archive_id = $1
        AND user_id = $2
        AND deleted_at IS NULL
      RETURNING archive_id
    `,
    [parsedArchiveId, userId],
  );

  if (rows.length === 0) {
    throw createServiceError(404, '?????밸븶筌믡꺂?????癲ル슢흮????轅붽틓?????????????욱룏???????낆젵.');
  }
};

const getArchiveTags = async () => {
  const valuesSql = FIXED_ARCHIVE_TAG_ROWS
    .map((_, index) => {
      const offset = index * 4;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
    })
    .join(', ');
  const values = FIXED_ARCHIVE_TAG_ROWS.flatMap((tag) => [
    tag.category,
    tag.name,
    tag.categoryOrder,
    tag.tagOrder,
  ]);
  const { rows } = await pool.query(
    `
      WITH fixed_tags(category, name, category_order, tag_order) AS (
        VALUES ${valuesSql}
      )
      SELECT
        t.tag_id,
        t.category,
        t.name,
        f.category_order,
        f.tag_order
      FROM fixed_tags f
      JOIN archive_tags t
        ON t.category = f.category
       AND t.name = f.name
      ORDER BY f.category_order, f.tag_order
    `,
    values,
  );

  const grouped = new Map(
    FIXED_ARCHIVE_TAG_GROUPS.map((group) => [
      group.category,
      {
        category: group.category,
        categoryName: group.categoryName,
        tags: [],
      },
    ]),
  );

  rows.forEach((row) => {
    const group = grouped.get(row.category);

    group.tags.push({
      tagId: Number(row.tag_id),
      name: row.name,
    });
  });

  return [...grouped.values()];
};

const findMyArchiveForImage = async (userId, archiveId, clientOrPool = pool) => {
  const parsedArchiveId = parseArchiveId(archiveId);
  const { rows } = await clientOrPool.query(
    `
      SELECT archive_id
      FROM user_archives
      WHERE archive_id = $1
        AND user_id = $2
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [parsedArchiveId, userId],
  );

  return rows[0] || null;
};

const uploadArchiveImages = async (userId, archiveId, files) => {
  const parsedArchiveId = parseArchiveId(archiveId);

  if (!Array.isArray(files) || files.length === 0) {
    throw createServiceError(400, '????野?????????????轅붽틓??????轅붽틓????낅마??????觀????꿔꺂?????');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const archive = await findMyArchiveForImage(userId, parsedArchiveId, client);

    if (!archive) {
      throw createServiceError(404, '?????밸븶筌믡꺂?????癲ル슢흮????轅붽틓?????????????욱룏???????낆젵.');
    }

    const { rows: countRows } = await client.query(
      `
        SELECT COUNT(*) AS count
        FROM user_archive_images
        WHERE archive_id = $1
      `,
      [parsedArchiveId],
    );
    const existingImageCount = Number(countRows[0]?.count || 0);

    if (existingImageCount + files.length > 3) {
      throw createServiceError(400, '?????밸븶筌믡꺂???????????轅붽틓??????轅붽틓????彛? 3?饔앷옇??????? ????野?????????????????????낆젵.');
    }

    const uploadedImages = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const imageUrl = await uploadFileToS3(
        file.buffer,
        file.originalname,
        file.mimetype,
        userId,
      );
      const sortOrder = existingImageCount + index;
      const { rows } = await client.query(
        `
          INSERT INTO user_archive_images (
            archive_id,
            image_url,
            sort_order,
            created_at
          )
          VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
          RETURNING
            image_id,
            image_url,
            sort_order
        `,
        [parsedArchiveId, imageUrl, sortOrder],
      );

      uploadedImages.push(mapArchiveImageResponse(rows[0]));
    }

    await client.query('COMMIT');
    return uploadedImages;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const deleteArchiveImage = async (userId, archiveId, imageId) => {
  const parsedArchiveId = parseArchiveId(archiveId);
  const parsedImageId = parseArchiveImageId(imageId);
  const archive = await findMyArchiveForImage(userId, parsedArchiveId);

  if (!archive) {
    throw createServiceError(404, '?????밸븶筌믡꺂?????癲ル슢흮????轅붽틓?????????????욱룏???????낆젵.');
  }

  const { rows } = await pool.query(
    `
      DELETE FROM user_archive_images
      WHERE image_id = $1
        AND archive_id = $2
      RETURNING image_id
    `,
    [parsedImageId, parsedArchiveId],
  );

  if (rows.length === 0) {
    throw createServiceError(404, '?????밸븶筌믡꺂???????????轅붽틓??????轅붽틓?????????????욱룏???????낆젵.');
  }
};

// raw_materials(JSONB ??ш끽維뽳쭩?壤굿??뽯쑆?????????꿔꺂?ｉ뜮???????ㅿ폁??????살퓢癲??????嶺뚮죭釉뚮댘???????곕츣?? ???ル봿?????????쇨덧?筌먦렜逾?null.
const buildIngredientsText = (rawMaterials) => {
  if (!rawMaterials) {
    return null;
  }

  let list = rawMaterials;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (error) {
      return null;
    }
  }

  if (!Array.isArray(list)) {
    return null;
  }

  const names = list
    .map((item) => {
      if (!item) {
        return null;
      }
      if (typeof item === 'string') {
        return item.trim();
      }
      const name = item.name
        || item.ingredient
        || item.rawMaterial
        || item.raw_material
        || item.mainIngredient;
      return typeof name === 'string' ? name.trim() : null;
    })
    .filter((name) => name);

  return names.length > 0 ? names.join(', ') : null;
};

// funding_reviews.image_urls(JSONB ??ш끽維뽳쭩?壤굿??뽯쑆? ??[{ imageId, imageUrl, sortOrder }]
const mapFundingReviewImages = (imageUrls) => {
  let list = imageUrls;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (error) {
      return [];
    }
  }

  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .filter((url) => typeof url === 'string' && url.trim().length > 0)
    .map((url, index) => ({
      imageId: index + 1,
      imageUrl: url,
      sortOrder: index,
    }));
};

// ?轅붽틓????????蹂κ텤?熬곎逾???? ?轅붽틓????????????轅붽틓??熬곥끇釉띄춯誘좊???(GET /api/mypage/fundings/participated)
// ??β뼯援?????????밸븶??PAID)??????용츧?嶺뚮?援ο쭩????????뀀땽 ?????????????癲ル슢????1??嚥싲갭큔??????ш끽維뽳쭩??? ?轅붽틓????彛???轅붽틓????????
const getParticipatedFundings = async (userId) => {
  const { rows } = await pool.query(
    `
      SELECT
        recent.funding_id,
        recent.order_id,
        fp.title AS project_name,
        fp.alcohol_percentage AS abv,
        fp.thumbnail_url,
        fp.status AS funding_status,
        fp.raw_materials,
        ba.brewery_name,
        u.nickname AS brewery_nickname,
        fr.review_id
      FROM (
        SELECT DISTINCT ON (o.funding_id)
          o.funding_id,
          o.order_id
        FROM orders o
        WHERE o.user_id = $1
          AND o.order_status = 'PAID'
          AND o.funding_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM user_archives ua
            WHERE ua.user_id = $1
              AND ua.archive_type = 'FUNDING'
              AND ua.funding_id = o.funding_id
              AND ua.deleted_at IS NULL
          )
        ORDER BY o.funding_id, o.order_id DESC
      ) recent
      JOIN funding_projects fp ON fp.funding_id = recent.funding_id
      LEFT JOIN users u ON u.user_id = fp.brewery_user_id
      LEFT JOIN LATERAL (
        SELECT brewery_name
        FROM brewery_auth
        WHERE user_id = fp.brewery_user_id
        ORDER BY
          CASE WHEN status = 'APPROVED' THEN 0 ELSE 1 END,
          updated_at DESC,
          application_id DESC
        LIMIT 1
      ) ba ON TRUE
      LEFT JOIN LATERAL (
        SELECT review_id
        FROM funding_reviews
        WHERE funding_id = recent.funding_id
          AND user_id = $1
        ORDER BY review_id DESC
        LIMIT 1
      ) fr ON TRUE
      ORDER BY recent.order_id DESC
    `,
    [userId],
  );

  return rows.map((row) => {
    const reviewId = row.review_id === null || row.review_id === undefined
      ? null
      : Number(row.review_id);

    return {
      fundingId: Number(row.funding_id),
      orderId: Number(row.order_id),
      projectName: row.project_name,
      drinkName: row.project_name,
      breweryName: row.brewery_name || row.brewery_nickname || null,
      ingredients: buildIngredientsText(row.raw_materials),
      abv: toNullableNumber(row.abv),
      thumbnailUrl: row.thumbnail_url || null,
      fundingStatus: row.funding_status,
      hasReview: reviewId !== null,
      reviewId,
    };
  });
};

// ????????袁ㅻ쇀?????怨쀫뎐??????怨쀫탾??(GET /api/mypage/fundings/{fundingId}/review)
// ???ㅼ뒧?戮レ땡??????????????袁ㅻ쇀??1?轅몄뫅??????????밸븶筌믡꺂??????????????嚥싲갭큔?댁옊???????????????뀀땽 ??꿔꺂?€〓뀥??????ш끽維뽳쭩??? ?????쇨덧?筌먦렜逾?null.
const getMyFundingReview = async (userId, fundingId) => {
  const parsedFundingId = Number(fundingId);

  if (!Number.isInteger(parsedFundingId) || parsedFundingId <= 0) {
    throw createServiceError(400, '?????援???? ??? ????ID??????뽯쨦??');
  }

  const { rows } = await pool.query(
    `
      SELECT
        review_id,
        rating,
        content,
        mood,
        pairing,
        image_urls
      FROM funding_reviews
      WHERE funding_id = $1
        AND user_id = $2
      ORDER BY review_id DESC
      LIMIT 1
    `,
    [parsedFundingId, userId],
  );

  const review = rows[0];
  if (!review) {
    return null;
  }

  return {
    reviewId: Number(review.review_id),
    rating: toNullableNumber(review.rating),
    tastingNote: review.content,
    mood: review.mood,
    pairing: review.pairing,
    images: mapFundingReviewImages(review.image_urls),
  };
};

module.exports = {
  getMyProfile,
  checkNickname,
  updateNickname,
  updateProfileImage,
  changeMyPassword,
  requestPhoneVerification,
  updatePhoneNumberWithVerification,
  normalizePhoneNumber,
  generatePhoneVerificationCode,
  checkOctomoMessageExists,
  getMyPageSummary,
  getMyBadges,
  evaluateBadgeConditions,
  grantEarnedBadges,
  getUserBadgeRows,
  getMySulbti,
  getMySulbtiShareLink,
  saveMySulbti,
  convertAndSaveMySulbtiSurvey,
  findSulbtiTypeByCode,
  mapSulbtiResponse,
  getEmptySulbtiResponse,
  getMyArchives,
  getMyArchiveDetail,
  createMyArchive,
  updateMyArchive,
  deleteMyArchive,
  getArchiveTags,
  uploadArchiveImages,
  deleteArchiveImage,
  findMyArchiveForImage,
  mapArchiveImageResponse,
  normalizeArchiveFormPayload,
  normalizeArchiveDeleteImageIds,
  mapArchiveResponse,
  validateArchivePayload,
  validateTagIds,
  getParticipatedFundings,
  getMyFundingReview,
};
