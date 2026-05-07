const pool = require('../config/db');

const findUserByKakaoId = async (kakaoId) => {
  const { rows } = await pool.query(
    `
      SELECT
        user_id,
        email,
        nickname,
        role,
        provider,
        kakao_id,
        profile_image,
        last_login_at
      FROM users
      WHERE kakao_id = $1
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [kakaoId],
  );

  return rows[0] || null;
};

const createKakaoUser = async ({ kakaoId, email, nickname, profileImage }) => {
  const { rows } = await pool.query(
    `
      INSERT INTO users (
        email,
        nickname,
        provider,
        kakao_id,
        profile_image,
        last_login_at,
        updated_at
      )
      VALUES ($1, $2, 'kakao', $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING
        user_id,
        email,
        nickname,
        role,
        provider,
        kakao_id,
        profile_image,
        last_login_at
    `,
    [email, nickname, kakaoId, profileImage],
  );

  return rows[0];
};

const updateKakaoUserLastLogin = async (userId) => {
  const { rows } = await pool.query(
    `
      UPDATE users
      SET
        last_login_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING
        user_id,
        email,
        nickname,
        role,
        provider,
        kakao_id,
        profile_image,
        last_login_at
    `,
    [userId],
  );

  return rows[0];
};

const findOrCreateKakaoUser = async (kakaoProfile) => {
  const existingUser = await findUserByKakaoId(kakaoProfile.kakaoId);

  if (existingUser) {
    return updateKakaoUserLastLogin(existingUser.user_id);
  }

  return createKakaoUser(kakaoProfile);
};

const findUserById = async (userId) => {
  const { rows } = await pool.query(
    `
      SELECT
        user_id,
        email,
        nickname,
        phone_number,
        role,
        provider,
        profile_image,
        last_login_at
      FROM users
      WHERE user_id = $1
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [userId],
  );

  return rows[0] || null;
};

const createServiceError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const isNicknameUsedByAnotherUser = async (nickname, userId) => {
  const { rows } = await pool.query(
    `
      SELECT user_id
      FROM users
      WHERE nickname = $1
        AND user_id <> $2
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [nickname, userId],
  );

  return rows.length > 0;
};

const updateUserProfile = async (userId, updateData) => {
  const currentUser = await findUserById(userId);

  if (!currentUser) {
    throw createServiceError(404, 'user not found');
  }

  if (
    Object.prototype.hasOwnProperty.call(updateData, 'nickname') &&
    updateData.nickname !== currentUser.nickname
  ) {
    const duplicated = await isNicknameUsedByAnotherUser(updateData.nickname, userId);

    if (duplicated) {
      throw createServiceError(409, 'nickname already exists');
    }
  }

  const setClauses = [];
  const values = [];
  let parameterIndex = 1;

  if (Object.prototype.hasOwnProperty.call(updateData, 'nickname')) {
    setClauses.push(`nickname = $${parameterIndex}`);
    values.push(updateData.nickname);
    parameterIndex += 1;
  }

  if (Object.prototype.hasOwnProperty.call(updateData, 'phoneNumber')) {
    setClauses.push(`phone_number = $${parameterIndex}`);
    values.push(updateData.phoneNumber);
    parameterIndex += 1;
  }

  if (Object.prototype.hasOwnProperty.call(updateData, 'profileImage')) {
    setClauses.push(`profile_image = $${parameterIndex}`);
    values.push(updateData.profileImage);
    parameterIndex += 1;
  }

  setClauses.push('updated_at = CURRENT_TIMESTAMP');
  values.push(userId);

  const { rows } = await pool.query(
    `
      UPDATE users
      SET ${setClauses.join(', ')}
      WHERE user_id = $${parameterIndex}
        AND deleted_at IS NULL
      RETURNING
        user_id,
        email,
        nickname,
        phone_number,
        role,
        provider,
        profile_image,
        updated_at
    `,
    values,
  );

  if (rows.length === 0) {
    throw createServiceError(404, 'user not found');
  }

  return rows[0];
};

module.exports = {
  findUserByKakaoId,
  createKakaoUser,
  updateKakaoUserLastLogin,
  findOrCreateKakaoUser,
  findUserById,
  updateUserProfile,
};
