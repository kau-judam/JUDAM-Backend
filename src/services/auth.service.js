const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { sendPasswordResetCodeEmail } = require('./mail.service');

const PASSWORD_RESET_EXPIRES_IN_MINUTES = 5;
const PASSWORD_RESET_TOKEN_EXPIRES_IN_MINUTES = 10;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;
const PASSWORD_SALT_ROUNDS = 10;

const createServiceError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getPasswordResetSecret = () => (
  process.env.PASSWORD_RESET_SECRET ||
  process.env.JWT_SECRET ||
  'judam-password-reset-development-secret'
);

const hashPasswordResetValue = (value) =>
  crypto
    .createHmac('sha256', getPasswordResetSecret())
    .update(String(value))
    .digest('hex');

const generatePasswordResetCode = () =>
  String(crypto.randomInt(0, 1000000)).padStart(6, '0');

const generatePasswordResetToken = () => crypto.randomBytes(32).toString('base64url');

const findLocalUserByEmail = async (client, email) => {
  const { rows } = await client.query(
    `
    SELECT user_id, email, provider
    FROM users
    WHERE email = $1
      AND provider = 'local'
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [email]
  );

  return rows[0] || null;
};

const requestPasswordResetVerification = async (email) => {
  const client = await pool.connect();

  try {
    const user = await findLocalUserByEmail(client, email);

    if (!user) {
      return {
        email,
        expiresInMinutes: PASSWORD_RESET_EXPIRES_IN_MINUTES,
        sent: false,
      };
    }

    const verificationCode = generatePasswordResetCode();
    const verificationCodeHash = hashPasswordResetValue(`${email}:${verificationCode}`);

    await client.query(
      `
      INSERT INTO password_reset_verifications (
        email,
        verification_code_hash,
        expires_at,
        used,
        attempt_count
      )
      VALUES (
        $1,
        $2,
        CURRENT_TIMESTAMP + ($3::text || ' minutes')::interval,
        false,
        0
      )
      `,
      [email, verificationCodeHash, PASSWORD_RESET_EXPIRES_IN_MINUTES]
    );

    await sendPasswordResetCodeEmail({
      to: email,
      verificationCode,
      expiresInMinutes: PASSWORD_RESET_EXPIRES_IN_MINUTES,
    });

    return {
      email,
      expiresInMinutes: PASSWORD_RESET_EXPIRES_IN_MINUTES,
      sent: true,
    };
  } finally {
    client.release();
  }
};

const getLatestUsablePasswordResetVerification = async (client, email) => {
  const { rows } = await client.query(
    `
    SELECT
      verification_id,
      email,
      verification_code_hash,
      expires_at,
      used,
      attempt_count,
      reset_token_hash,
      reset_token_expires_at
    FROM password_reset_verifications
    WHERE email = $1
      AND used = false
      AND reset_token_hash IS NULL
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE
    `,
    [email]
  );

  return rows[0] || null;
};

const verifyPasswordResetCode = async ({ email, verificationCode }) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const verification = await getLatestUsablePasswordResetVerification(client, email);

    if (!verification) {
      throw createServiceError(400, '인증번호가 올바르지 않거나 만료되었습니다.');
    }

    if (new Date(verification.expires_at).getTime() <= Date.now()) {
      throw createServiceError(400, '인증번호가 올바르지 않거나 만료되었습니다.');
    }

    if (Number(verification.attempt_count || 0) >= PASSWORD_RESET_MAX_ATTEMPTS) {
      throw createServiceError(429, '인증번호 입력 횟수를 초과했습니다. 다시 요청해주세요.');
    }

    const requestedCodeHash = hashPasswordResetValue(`${email}:${verificationCode}`);

    if (verification.verification_code_hash !== requestedCodeHash) {
      await client.query(
        `
        UPDATE password_reset_verifications
        SET attempt_count = attempt_count + 1
        WHERE verification_id = $1
        `,
        [verification.verification_id]
      );
      throw createServiceError(400, '인증번호가 올바르지 않거나 만료되었습니다.');
    }

    const passwordResetToken = generatePasswordResetToken();
    const passwordResetTokenHash = hashPasswordResetValue(passwordResetToken);

    await client.query(
      `
      UPDATE password_reset_verifications
      SET
        reset_token_hash = $1,
        reset_token_expires_at = CURRENT_TIMESTAMP + ($2::text || ' minutes')::interval
      WHERE verification_id = $3
      `,
      [
        passwordResetTokenHash,
        PASSWORD_RESET_TOKEN_EXPIRES_IN_MINUTES,
        verification.verification_id,
      ]
    );

    await client.query('COMMIT');

    return {
      passwordResetToken,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const confirmPasswordReset = async ({ passwordResetToken, newPassword }) => {
  const client = await pool.connect();
  const passwordResetTokenHash = hashPasswordResetValue(passwordResetToken);

  try {
    await client.query('BEGIN');

    const { rows: verificationRows } = await client.query(
      `
      SELECT
        verification_id,
        email,
        reset_token_expires_at
      FROM password_reset_verifications
      WHERE reset_token_hash = $1
        AND used = false
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
      `,
      [passwordResetTokenHash]
    );

    const verification = verificationRows[0];

    if (
      !verification ||
      !verification.reset_token_expires_at ||
      new Date(verification.reset_token_expires_at).getTime() <= Date.now()
    ) {
      throw createServiceError(400, '비밀번호 재설정 토큰이 올바르지 않거나 만료되었습니다.');
    }

    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);
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
      [passwordHash, verification.email]
    );

    if (userRows.length === 0) {
      throw createServiceError(404, '해당 이메일로 가입된 계정을 찾을 수 없습니다.');
    }

    await client.query(
      `
      UPDATE password_reset_verifications
      SET
        used = true,
        used_at = CURRENT_TIMESTAMP
      WHERE verification_id = $1
      `,
      [verification.verification_id]
    );

    await client.query(
      `
      UPDATE refresh_tokens
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
        AND revoked_at IS NULL
      `,
      [userRows[0].user_id]
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
  PASSWORD_RESET_EXPIRES_IN_MINUTES,
  requestPasswordResetVerification,
  verifyPasswordResetCode,
  confirmPasswordReset,
};
