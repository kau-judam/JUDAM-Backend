const crypto = require('crypto');
const pool = require('../config/db');
const {
  normalizePhoneNumber,
  generatePhoneVerificationCode,
  checkOctomoMessageExists,
} = require('./mypage.service');

const AUTH_PHONE_VERIFICATION_EXPIRES_IN_MINUTES = 5;
const OCTOMO_RECEIVE_NUMBER = process.env.OCTOMO_RECEIVE_NUMBER || '1666-3538';

const createServiceError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const generatePhoneVerificationToken = () => crypto.randomBytes(32).toString('hex');

const requestAuthPhoneVerification = async (phoneNumber) => {
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
  const verificationCode = generatePhoneVerificationCode();

  await pool.query(
    `
      INSERT INTO auth_phone_verifications (
        phone_number,
        code,
        expires_at
      )
      VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '5 minutes')
    `,
    [normalizedPhoneNumber, verificationCode],
  );

  return {
    phoneNumber: normalizedPhoneNumber,
    verificationCode,
    sendTo: OCTOMO_RECEIVE_NUMBER,
    guideMessage: `휴대폰 문자로 ${verificationCode}을 ${OCTOMO_RECEIVE_NUMBER}로 보내주세요.`,
  };
};

const confirmAuthPhoneVerification = async (phoneNumber, verificationCode) => {
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
  const normalizedVerificationCode = typeof verificationCode === 'string'
    ? verificationCode.trim()
    : '';

  if (!normalizedVerificationCode) {
    throw createServiceError(400, '인증번호를 입력해주세요.');
  }

  const { rows } = await pool.query(
    `
      SELECT
        verification_id,
        phone_number,
        code
      FROM auth_phone_verifications
      WHERE phone_number = $1
        AND code = $2
        AND verified_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [normalizedPhoneNumber, normalizedVerificationCode],
  );
  const verification = rows[0];

  if (!verification) {
    throw createServiceError(400, '전화번호 인증 요청이 없거나 만료되었습니다.');
  }

  const exists = await checkOctomoMessageExists(normalizedPhoneNumber, normalizedVerificationCode);

  if (!exists) {
    throw createServiceError(400, '인증 문자가 확인되지 않았습니다.');
  }

  const verificationToken = generatePhoneVerificationToken();
  const { rows: updatedRows } = await pool.query(
    `
      UPDATE auth_phone_verifications
      SET
        verified_at = CURRENT_TIMESTAMP,
        verification_token = $1
      WHERE verification_id = $2
      RETURNING
        phone_number,
        verification_token
    `,
    [verificationToken, verification.verification_id],
  );

  return {
    phoneNumber: updatedRows[0].phone_number,
    verified: true,
    phoneVerificationToken: updatedRows[0].verification_token,
  };
};

const verifyAuthPhoneVerificationToken = async (phoneNumber, verificationToken) => {
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
  const normalizedVerificationToken = typeof verificationToken === 'string'
    ? verificationToken.trim()
    : '';

  if (!normalizedVerificationToken) {
    return {
      isValid: false,
      phoneNumber: normalizedPhoneNumber,
    };
  }

  const { rows } = await pool.query(
    `
      SELECT verification_id
      FROM auth_phone_verifications
      WHERE phone_number = $1
        AND verification_token = $2
        AND verified_at IS NOT NULL
      ORDER BY verified_at DESC
      LIMIT 1
    `,
    [normalizedPhoneNumber, normalizedVerificationToken],
  );

  return {
    isValid: rows.length > 0,
    phoneNumber: normalizedPhoneNumber,
  };
};

module.exports = {
  AUTH_PHONE_VERIFICATION_EXPIRES_IN_MINUTES,
  requestAuthPhoneVerification,
  confirmAuthPhoneVerification,
  verifyAuthPhoneVerificationToken,
};
