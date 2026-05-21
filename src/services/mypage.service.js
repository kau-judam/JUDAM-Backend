const {
  findUserById,
  updateUserProfile,
  isNicknameExists,
} = require('./user.service');
const { uploadFileToS3 } = require('./s3.service');
const pool = require('../config/db');

const createServiceError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

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
    throw createServiceError(404, '사용자를 찾을 수 없습니다.');
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

const updatePhoneNumber = async (userId, phoneNumber) => {
  const user = await updateUserProfile(userId, { phoneNumber });

  return {
    phoneNumber: user.phone_number,
  };
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

const getLatestSulbti = async (userId) => {
  const { rows } = await pool.query(
    `
      SELECT
        r.result_id,
        r.created_at,
        t.type_code,
        t.type_name,
        t.description
      FROM sul_bti_results r
      LEFT JOIN sul_bti_types t ON r.type_id = t.type_id
      WHERE r.user_id = $1
      ORDER BY r.created_at DESC
      LIMIT 1
    `,
    [userId],
  );

  const latestResult = rows[0];

  if (!latestResult) {
    return {
      hasResult: false,
      type: null,
      title: null,
      summary: null,
      tags: [],
    };
  }

  return {
    hasResult: true,
    type: latestResult.type_code || null,
    title: latestResult.type_name || null,
    summary: latestResult.description || null,
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
  tags: [],
  createdAt: null,
  updatedAt: null,
});

const mapSulbtiResponse = (row) => ({
  hasResult: true,
  type: row.type_code || null,
  title: row.type_name || null,
  description: row.description || null,
  scores: {
    sweetness: Number(row.sweetness_score),
    body: Number(row.body_score),
    carbonation: Number(row.carbonation_score),
    flavor: Number(row.flavor_score),
    abv: Number(row.abv_score),
  },
  tags: [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

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
      FROM sul_bti_results r
      LEFT JOIN sul_bti_types t ON r.type_id = t.type_id
      WHERE r.user_id = $1
      LIMIT 1
    `,
    [userId],
  );

  if (!rows[0]) {
    return getEmptySulbtiResponse();
  }

  return mapSulbtiResponse(rows[0]);
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
    throw createServiceError(400, '술BTI 유형을 입력해주세요.');
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
    throw createServiceError(400, '술BTI 점수는 1~5 사이의 숫자여야 합니다.');
  }

  return {
    typeCode,
    ...scores,
  };
};

const saveMySulbti = async (userId, payload) => {
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
    throw createServiceError(400, '유효하지 않은 술BTI 유형입니다.');
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

module.exports = {
  getMyProfile,
  checkNickname,
  updateNickname,
  updatePhoneNumber,
  updateProfileImage,
  getMyPageSummary,
  getMySulbti,
  saveMySulbti,
  findSulbtiTypeByCode,
  mapSulbtiResponse,
  getEmptySulbtiResponse,
};
