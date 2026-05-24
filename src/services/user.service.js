const pool = require('../config/db');

const findUserByKakaoId = async (kakaoId) => {
  const { rows } = await pool.query(
    `
      SELECT
        user_id,
        email,
        phone_number,
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

const findUserByEmail = async (email) => {
  const { rows } = await pool.query(
    `
      SELECT
        user_id,
        email,
        password,
        nickname,
        phone_number,
        role,
        provider,
        kakao_id,
        profile_image,
        last_login_at
      FROM users
      WHERE email = $1
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [email],
  );

  return rows[0] || null;
};

const createKakaoUser = async ({
  kakaoId,
  email,
  nickname,
  phoneNumber = null,
  profileImage = null,
  role = 'USER',
  termsAgreed = false,
  privacyAgreed = false,
  marketingAgreed = false,
}) => {
  const { rows } = await pool.query(
    `
      INSERT INTO users (
        email,
        nickname,
        phone_number,
        role,
        provider,
        kakao_id,
        profile_image,
        terms_agreed,
        privacy_agreed,
        marketing_agreed,
        terms_agreed_at,
        privacy_agreed_at,
        marketing_agreed_at,
        last_login_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        'kakao',
        $5,
        $6,
        $7,
        $8,
        $9,
        CASE WHEN $7 THEN CURRENT_TIMESTAMP ELSE NULL END,
        CASE WHEN $8 THEN CURRENT_TIMESTAMP ELSE NULL END,
        CASE WHEN $9 THEN CURRENT_TIMESTAMP ELSE NULL END,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      RETURNING
        user_id,
        email,
        nickname,
        phone_number,
        role,
        provider,
        kakao_id,
        profile_image,
        marketing_agreed,
        last_login_at
    `,
    [email, nickname, phoneNumber, role, kakaoId, profileImage, termsAgreed, privacyAgreed, marketingAgreed],
  );

  return rows[0];
};

const updateKakaoUserProfileCompletion = async ({
  userId,
  kakaoId,
  email,
  nickname,
  phoneNumber,
  profileImage,
  role = 'USER',
  termsAgreed = false,
  privacyAgreed = false,
  marketingAgreed = false,
}) => {
  const { rows } = await pool.query(
    `
      UPDATE users
      SET
        email = $1,
        nickname = $2,
        phone_number = $3,
        role = $4,
        kakao_id = $5,
        profile_image = $6,
        terms_agreed = $7,
        privacy_agreed = $8,
        marketing_agreed = $9,
        terms_agreed_at = CASE
          WHEN $7 THEN COALESCE(terms_agreed_at, CURRENT_TIMESTAMP)
          ELSE terms_agreed_at
        END,
        privacy_agreed_at = CASE
          WHEN $8 THEN COALESCE(privacy_agreed_at, CURRENT_TIMESTAMP)
          ELSE privacy_agreed_at
        END,
        marketing_agreed_at = CASE
          WHEN $9 THEN COALESCE(marketing_agreed_at, CURRENT_TIMESTAMP)
          ELSE NULL
        END,
        last_login_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $10
        AND deleted_at IS NULL
      RETURNING
        user_id,
        email,
        nickname,
        phone_number,
        role,
        provider,
        kakao_id,
        profile_image,
        marketing_agreed,
        last_login_at
    `,
    [
      email,
      nickname,
      phoneNumber,
      role,
      kakaoId,
      profileImage,
      termsAgreed,
      privacyAgreed,
      marketingAgreed,
      userId,
    ],
  );

  if (rows.length === 0) {
    throw createServiceError(404, 'user not found');
  }

  return rows[0];
};

const createLocalUser = async ({
  email,
  passwordHash,
  nickname,
  phoneNumber,
  role = 'USER',
  termsAgreed = false,
  privacyAgreed = false,
  marketingAgreed = false,
}) => {
  const { rows } = await pool.query(
    `
      INSERT INTO users (
        email,
        password,
        nickname,
        phone_number,
        role,
        provider,
        kakao_id,
        profile_image,
        terms_agreed,
        privacy_agreed,
        marketing_agreed,
        terms_agreed_at,
        privacy_agreed_at,
        marketing_agreed_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        'local',
        NULL,
        NULL,
        $6,
        $7,
        $8,
        CASE WHEN $6 THEN CURRENT_TIMESTAMP ELSE NULL END,
        CASE WHEN $7 THEN CURRENT_TIMESTAMP ELSE NULL END,
        CASE WHEN $8 THEN CURRENT_TIMESTAMP ELSE NULL END,
        CURRENT_TIMESTAMP
      )
      RETURNING
        user_id,
        email,
        nickname,
        phone_number,
        role,
        provider,
        profile_image,
        marketing_agreed,
        last_login_at
    `,
    [email, passwordHash, nickname, phoneNumber, role, termsAgreed, privacyAgreed, marketingAgreed],
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
        AND deleted_at IS NULL
      RETURNING
        user_id,
        email,
        nickname,
        phone_number,
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

const updateUserLastLogin = async (userId) => {
  const { rows } = await pool.query(
    `
      UPDATE users
      SET
        last_login_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
        AND deleted_at IS NULL
      RETURNING
        user_id,
        email,
        nickname,
        phone_number,
        role,
        provider,
        profile_image,
        last_login_at
    `,
    [userId],
  );

  return rows[0] || null;
};

const updateLocalUserLastLogin = async (userId) => {
  const { rows } = await pool.query(
    `
      UPDATE users
      SET
        last_login_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
        AND deleted_at IS NULL
      RETURNING
        user_id,
        email,
        nickname,
        phone_number,
        role,
        provider,
        profile_image,
        last_login_at
    `,
    [userId],
  );

  return rows[0];
};

const updateUserRole = async (userId, role) => {
  const { rows } = await pool.query(
    `
      UPDATE users
      SET
        role = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $2
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
    [role, userId],
  );

  if (rows.length === 0) {
    throw createServiceError(404, '사용자를 찾을 수 없습니다.');
  }

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

const createPasswordResetVerification = async (email, code) => {
  const { rows } = await pool.query(
    `
      INSERT INTO password_reset_verifications (
        email,
        code,
        expires_at
      )
      VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '5 minutes')
      RETURNING
        verification_id,
        email,
        code,
        expires_at,
        verified_at,
        created_at
    `,
    [email, code],
  );

  return rows[0];
};

const getLatestPendingPasswordResetVerification = async (email) => {
  const { rows } = await pool.query(
    `
      SELECT
        verification_id,
        email,
        code,
        expires_at,
        verified_at,
        created_at
      FROM password_reset_verifications
      WHERE email = $1
        AND verified_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [email],
  );

  return rows[0] || null;
};

const verifyPasswordResetVerification = async (email, code) => {
  const verification = await getLatestPendingPasswordResetVerification(email);

  if (!verification || verification.code !== code) {
    return null;
  }

  const { rows } = await pool.query(
    `
      UPDATE password_reset_verifications
      SET verified_at = CURRENT_TIMESTAMP
      WHERE verification_id = $1
      RETURNING
        verification_id,
        email,
        code,
        expires_at,
        verified_at,
        created_at
    `,
    [verification.verification_id],
  );

  return rows[0] || null;
};

const resetPasswordWithVerification = async (email, code, passwordHash) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: verificationRows } = await client.query(
      `
        SELECT verification_id
        FROM password_reset_verifications
        WHERE email = $1
          AND code = $2
          AND verified_at IS NOT NULL
          AND expires_at > CURRENT_TIMESTAMP
        ORDER BY verified_at DESC
        LIMIT 1
      `,
      [email, code],
    );

    if (verificationRows.length === 0) {
      throw createServiceError(400, '인증번호 확인이 필요합니다.');
    }

    const { rows: userRows } = await client.query(
      `
        UPDATE users
        SET
          password = $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE email = $2
          AND provider = 'local'
          AND deleted_at IS NULL
        RETURNING user_id
      `,
      [passwordHash, email],
    );

    if (userRows.length === 0) {
      throw createServiceError(404, '해당 이메일로 가입된 계정을 찾을 수 없습니다.');
    }

    await client.query(
      `
        UPDATE refresh_tokens
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
          AND revoked_at IS NULL
      `,
      [userRows[0].user_id],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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

const isNicknameExists = async (nickname) => {
  const { rows } = await pool.query(
    `
      SELECT user_id
      FROM users
      WHERE nickname = $1
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [nickname],
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

const deleteUserAccount = async (userId) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
        UPDATE users
        SET
          deleted_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
          AND deleted_at IS NULL
        RETURNING user_id
      `,
      [userId],
    );

    if (rows.length === 0) {
      throw createServiceError(404, 'user not found');
    }

    await client.query(
      `
        UPDATE refresh_tokens
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
          AND revoked_at IS NULL
      `,
      [userId],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  findUserByKakaoId,
  findUserByEmail,
  createKakaoUser,
  updateKakaoUserProfileCompletion,
  createLocalUser,
  updateKakaoUserLastLogin,
  updateLocalUserLastLogin,
  updateUserLastLogin,
  updateUserRole,
  findOrCreateKakaoUser,
  findUserById,
  updateUserProfile,
  deleteUserAccount,
  isNicknameUsedByAnotherUser,
  isNicknameExists,
  createPasswordResetVerification,
  verifyPasswordResetVerification,
  resetPasswordWithVerification,
};
