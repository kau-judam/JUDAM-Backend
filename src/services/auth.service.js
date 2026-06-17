const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { sendPasswordResetCodeEmail } = require('./mail.service');
const {
  requestAuthPhoneVerification,
  confirmAuthPhoneVerification,
} = require('./auth-phone.service');
const { normalizePhoneNumber } = require('./mypage.service');

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

const PASSWORD_RESET_PHONE_MISMATCH_MESSAGE = '입력한 이메일 또는 전화번호를 확인해주세요.';
const PHONE_VERIFICATION_INVALID_MESSAGE = '전화번호 인증번호가 올바르지 않거나 만료되었습니다.';

const normalizePasswordResetPhoneNumber = (phoneNumber) => {
  try {
    return normalizePhoneNumber(phoneNumber);
  } catch (error) {
    throw createServiceError(400, '전화번호 형식이 올바르지 않습니다.');
  }
};

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

const findLocalUserByEmailAndPhone = async (client, email, phoneNumber) => {
  const { rows } = await client.query(
    `
    SELECT user_id, email, phone_number, provider
    FROM users
    WHERE LOWER(email) = LOWER($1)
      AND provider = 'local'
      AND deleted_at IS NULL
      AND REGEXP_REPLACE(COALESCE(phone_number, ''), '[^0-9]', '', 'g') = $2
    LIMIT 1
    `,
    [email, phoneNumber]
  );

  return rows[0] || null;
};

const createPasswordResetTokenForEmail = async (client, email) => {
  const passwordResetToken = generatePasswordResetToken();
  const passwordResetTokenHash = hashPasswordResetValue(passwordResetToken);

  await client.query(
    `
    UPDATE password_reset_verifications
    SET
      used = true,
      used_at = COALESCE(used_at, CURRENT_TIMESTAMP)
    WHERE email = $1
      AND used = false
      AND reset_token_hash IS NOT NULL
    `,
    [email]
  );

  await client.query(
    `
    INSERT INTO password_reset_verifications (
      email,
      verification_code_hash,
      expires_at,
      used,
      attempt_count,
      reset_token_hash,
      reset_token_expires_at
    )
    VALUES (
      $1,
      NULL,
      CURRENT_TIMESTAMP + ($2::text || ' minutes')::interval,
      false,
      0,
      $3,
      CURRENT_TIMESTAMP + ($4::text || ' minutes')::interval
    )
    `,
    [
      email,
      PASSWORD_RESET_EXPIRES_IN_MINUTES,
      passwordResetTokenHash,
      PASSWORD_RESET_TOKEN_EXPIRES_IN_MINUTES,
    ]
  );

  return passwordResetToken;
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

const requestPasswordResetPhoneVerification = async ({ email, phoneNumber }) => {
  const normalizedPhoneNumber = normalizePasswordResetPhoneNumber(phoneNumber);
  const client = await pool.connect();

  try {
    const user = await findLocalUserByEmailAndPhone(client, email, normalizedPhoneNumber);

    if (!user) {
      throw createServiceError(400, PASSWORD_RESET_PHONE_MISMATCH_MESSAGE);
    }
  } finally {
    client.release();
  }

  const verification = await requestAuthPhoneVerification(normalizedPhoneNumber);

  return {
    phoneNumber: verification.phoneNumber,
    verificationCode: verification.verificationCode,
    sendTo: verification.sendTo,
    guideMessage: `인증번호 ${verification.verificationCode}을 ${verification.sendTo}로 문자 전송해주세요.`,
    expiresInMinutes: PASSWORD_RESET_EXPIRES_IN_MINUTES,
  };
};

const confirmPasswordResetPhoneVerification = async ({ email, phoneNumber, verificationCode }) => {
  const normalizedPhoneNumber = normalizePasswordResetPhoneNumber(phoneNumber);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const user = await findLocalUserByEmailAndPhone(client, email, normalizedPhoneNumber);

    if (!user) {
      throw createServiceError(400, PASSWORD_RESET_PHONE_MISMATCH_MESSAGE);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    throw error;
  }

  client.release();

  try {
    await confirmAuthPhoneVerification(normalizedPhoneNumber, verificationCode);
  } catch (error) {
    if (error.statusCode === 400) {
      throw createServiceError(error.statusCode, PHONE_VERIFICATION_INVALID_MESSAGE);
    }

    if (error.statusCode === 502) {
      throw createServiceError(502, '전화번호 인증 서비스와 통신할 수 없습니다.');
    }

    if (error.statusCode) {
      throw createServiceError(error.statusCode, '전화번호 인증 확인 중 오류가 발생했습니다.');
    }

    throw error;
  }

  const tokenClient = await pool.connect();

  try {
    await tokenClient.query('BEGIN');

    const passwordResetToken = await createPasswordResetTokenForEmail(tokenClient, email);

    await tokenClient.query('COMMIT');

    return {
      resetToken: passwordResetToken,
      passwordResetToken,
      expiresInMinutes: PASSWORD_RESET_TOKEN_EXPIRES_IN_MINUTES,
    };
  } catch (error) {
    await tokenClient.query('ROLLBACK');
    throw error;
  } finally {
    tokenClient.release();
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
  requestPasswordResetPhoneVerification,
  confirmPasswordResetPhoneVerification,
  confirmPasswordReset,
};
