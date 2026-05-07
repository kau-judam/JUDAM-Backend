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

module.exports = {
  findUserByKakaoId,
  createKakaoUser,
  updateKakaoUserLastLogin,
  findOrCreateKakaoUser,
  findUserById,
};
