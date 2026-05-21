const {
  findUserById,
  updateUserProfile,
  isNicknameExists,
} = require('./user.service');
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

module.exports = {
  getMyProfile,
  checkNickname,
  updateNickname,
  updatePhoneNumber,
  getMyPageSummary,
};
