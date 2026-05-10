const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { findUserById } = require('./user.service');

const ACCESS_TOKEN_EXPIRES_IN = '7d';
const REFRESH_TOKEN_EXPIRES_IN = '14d';
const REFRESH_TOKEN_EXPIRES_IN_MS = 14 * 24 * 60 * 60 * 1000;

const createServiceError = (statusCode, message, detail) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.detail = detail;
  return error;
};

const getJwtSecret = () => {
  if (!process.env.JWT_SECRET) {
    throw createServiceError(500, 'JWT_SECRET environment variable is missing', 'JWT_SECRET is required');
  }

  return process.env.JWT_SECRET;
};

const generateAccessToken = (user) => {
  return jwt.sign(
    {
      userId: user.user_id,
      provider: user.provider,
      role: user.role,
    },
    getJwtSecret(),
    {
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    },
  );
};

const generateRefreshToken = (userId) => {
  return jwt.sign(
    {
      userId,
    },
    getJwtSecret(),
    {
      expiresIn: REFRESH_TOKEN_EXPIRES_IN,
    },
  );
};

const saveRefreshToken = async ({ userId, refreshToken, expiresAt }) => {
  await pool.query(
    `
      INSERT INTO refresh_tokens (
        user_id,
        token,
        expires_at,
        revoked_at
      )
      VALUES ($1, $2, $3, NULL)
    `,
    [userId, refreshToken, expiresAt],
  );
};

const issueRefreshToken = async (userId) => {
  const refreshToken = generateRefreshToken(userId);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_IN_MS);

  await saveRefreshToken({
    userId,
    refreshToken,
    expiresAt,
  });

  return refreshToken;
};

const verifyRefreshToken = (refreshToken) => {
  try {
    return jwt.verify(refreshToken, getJwtSecret());
  } catch (error) {
    throw createServiceError(401, '유효하지 않은 refreshToken입니다.', error.message);
  }
};

const getStoredRefreshToken = async (refreshToken) => {
  const { rows } = await pool.query(
    `
      SELECT
        refresh_token_id,
        user_id,
        token,
        expires_at,
        revoked_at
      FROM refresh_tokens
      WHERE token = $1
      LIMIT 1
    `,
    [refreshToken],
  );

  return rows[0] || null;
};

const refreshAccessToken = async (refreshToken) => {
  const decoded = verifyRefreshToken(refreshToken);
  const storedToken = await getStoredRefreshToken(refreshToken);

  if (!storedToken || storedToken.revoked_at) {
    throw createServiceError(401, '유효하지 않은 refreshToken입니다.', 'refreshToken does not exist or has been revoked');
  }

  if (new Date(storedToken.expires_at).getTime() <= Date.now()) {
    throw createServiceError(401, '만료된 refreshToken입니다.', 'refreshToken has expired');
  }

  if (Number(storedToken.user_id) !== Number(decoded.userId)) {
    throw createServiceError(401, '유효하지 않은 refreshToken입니다.', 'refreshToken user does not match stored token');
  }

  const user = await findUserById(decoded.userId);

  if (!user) {
    throw createServiceError(401, '유효하지 않은 refreshToken입니다.', 'user not found');
  }

  return generateAccessToken(user);
};

const revokeRefreshToken = async (refreshToken) => {
  await pool.query(
    `
      UPDATE refresh_tokens
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE token = $1
        AND revoked_at IS NULL
    `,
    [refreshToken],
  );
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  saveRefreshToken,
  issueRefreshToken,
  refreshAccessToken,
  revokeRefreshToken,
};
