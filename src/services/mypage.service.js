const bcrypt = require('bcrypt');
const axios = require('axios');
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

const PASSWORD_SALT_ROUNDS = 10;
const OCTOMO_API_URL = process.env.OCTOMO_API_URL
  || 'https://api.octoverse.kr/octomo/v1/public/message/exists';
const OCTOMO_RECEIVE_NUMBER = process.env.OCTOMO_RECEIVE_NUMBER || '1666-3538';

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

const normalizePhoneNumber = (phoneNumber) => {
  if (typeof phoneNumber !== 'string') {
    throw createServiceError(400, '전화번호 형식이 올바르지 않습니다.');
  }

  const normalized = phoneNumber.replace(/\s/g, '').replace(/-/g, '');

  if (!/^010\d{7,8}$/.test(normalized)) {
    throw createServiceError(400, '전화번호 형식이 올바르지 않습니다.');
  }

  return normalized;
};

const generatePhoneVerificationCode = () => {
  const randomNumber = Math.floor(100000 + Math.random() * 900000);

  return `JUDAM${randomNumber}`;
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
    guideMessage: `휴대폰 문자로 ${verificationCode}을 ${OCTOMO_RECEIVE_NUMBER}로 보내주세요.`,
  };
};

const checkOctomoMessageExists = async (phoneNumber, verificationCode) => {
  if (!process.env.OCTOMO_API_KEY) {
    throw createServiceError(500, '전화번호 인증 서비스 설정이 누락되었습니다.');
  }

  try {
    const response = await axios.post(
      OCTOMO_API_URL,
      {
        mobileNum: phoneNumber,
        text: verificationCode,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Octomo ${process.env.OCTOMO_API_KEY}`,
        },
      },
    );

    return response.data?.exists === true;
  } catch (error) {
    throw createServiceError(502, '전화번호 인증 서비스와 통신할 수 없습니다.');
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
    throw createServiceError(400, '전화번호 인증 요청이 없거나 만료되었습니다.');
  }

  const exists = await checkOctomoMessageExists(normalizedPhoneNumber, normalizedVerificationCode);

  if (!exists) {
    throw createServiceError(400, '인증 문자가 확인되지 않았습니다.');
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
      throw createServiceError(404, '사용자를 찾을 수 없습니다.');
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
    throw createServiceError(404, '사용자를 찾을 수 없습니다.');
  }

  if (user.provider !== 'local') {
    throw createServiceError(400, '소셜 로그인 사용자는 비밀번호를 변경할 수 없습니다.');
  }

  const isPasswordValid = await bcrypt.compare(currentPassword, user.password || '');

  if (!isPasswordValid) {
    throw createServiceError(401, '현재 비밀번호가 올바르지 않습니다.');
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
  MOOD: '감성',
};

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
    throw createServiceError(400, `${fieldName} 값이 올바르지 않습니다.`);
  }

  return Number(stringValue);
};

const parseArchiveListQuery = (query = {}) => {
  const type = typeof query.type === 'string' && query.type.trim()
    ? query.type.trim().toLowerCase()
    : 'all';

  if (!hasOwn(ARCHIVE_QUERY_TYPES, type)) {
    throw createServiceError(400, '아카이브 타입이 올바르지 않습니다.');
  }

  const page = parseNonNegativeInteger(query.page, 0, 'page');
  const size = parseNonNegativeInteger(query.size, 10, 'size');

  if (size < 1) {
    throw createServiceError(400, 'size 값이 올바르지 않습니다.');
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
    throw createServiceError(400, '아카이브 ID가 올바르지 않습니다.');
  }

  return Number(stringValue);
};

const parseArchiveImageId = (imageId) => {
  const stringValue = String(imageId);

  if (!/^\d+$/.test(stringValue) || Number(stringValue) < 1) {
    throw createServiceError(400, '아카이브 이미지 ID가 올바르지 않습니다.');
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
    throw createServiceError(400, '아카이브 유형은 NORMAL 또는 FUNDING만 가능합니다.');
  }

  const normalized = archiveType.trim().toUpperCase();

  if (!ARCHIVE_TYPES.has(normalized)) {
    throw createServiceError(400, '아카이브 유형은 NORMAL 또는 FUNDING만 가능합니다.');
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
    throw createServiceError(400, `${fieldName} 값이 올바르지 않습니다.`);
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
    throw createServiceError(400, `${fieldName} 값이 올바르지 않습니다.`);
  }

  if (value < min || (max !== null && value > max)) {
    throw createServiceError(400, `${fieldName} 값이 올바르지 않습니다.`);
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
    throw createServiceError(400, `${fieldName} 값이 올바르지 않습니다.`);
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
    throw createServiceError(400, '기록 날짜 형식이 올바르지 않습니다.');
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw createServiceError(400, '기록 날짜 형식이 올바르지 않습니다.');
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
      throw createServiceError(400, 'tagIds는 배열이어야 합니다.');
    }

    validated.tagIds = body.tagIds;
  }

  if (!isPartial) {
    const customName = hasOwn(validated, 'customName') ? validated.customName : null;
    const alcoholId = hasOwn(validated, 'alcoholId') ? validated.alcoholId : null;

    if (!customName && alcoholId === null) {
      throw createServiceError(400, 'customName과 alcoholId 중 하나는 필요합니다.');
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
    throw createServiceError(400, '유효하지 않은 아카이브 태그입니다.');
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
    throw createServiceError(400, '유효하지 않은 아카이브 태그입니다.');
  }

  return uniqueTagIds;
};

const ensureArchiveHasDrinkName = (archiveData, currentArchive = null) => {
  const customName = hasOwn(archiveData, 'customName')
    ? archiveData.customName
    : currentArchive?.custom_name || null;
  const alcoholId = hasOwn(archiveData, 'alcoholId')
    ? archiveData.alcoholId
    : currentArchive?.alcohol_id || null;

  if (!customName && alcoholId === null) {
    throw createServiceError(400, 'customName과 alcoholId 중 하나는 필요합니다.');
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
      throw createServiceError(400, 'tagIds는 배열 형식이어야 합니다.');
    }
  }

  return stringValue.split(',').map((tagId) => Number(tagId.trim()));
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
    throw createServiceError(404, '아카이브를 찾을 수 없습니다.');
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

    const tagIds = await validateTagIds(client, archiveData.tagIds);
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
    return archive;
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
      throw createServiceError(404, '아카이브를 찾을 수 없습니다.');
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

    if (hasOwn(archiveData, 'tagIds')) {
      const tagIds = await validateTagIds(client, archiveData.tagIds);

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
    return archive;
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
    throw createServiceError(404, '아카이브를 찾을 수 없습니다.');
  }
};

const getArchiveTags = async () => {
  const { rows } = await pool.query(
    `
      SELECT
        tag_id,
        category,
        name
      FROM archive_tags
      ORDER BY
        CASE category
          WHEN 'TASTE' THEN 1
          WHEN 'AROMA' THEN 2
          WHEN 'SITUATION' THEN 3
          WHEN 'MOOD' THEN 4
          ELSE 99
        END,
        tag_id
    `,
  );

  const grouped = new Map();

  rows.forEach((row) => {
    const group = grouped.get(row.category) || {
      category: row.category,
      categoryName: ARCHIVE_TAG_CATEGORY_NAMES[row.category] || row.category,
      tags: [],
    };

    group.tags.push({
      tagId: Number(row.tag_id),
      name: row.name,
    });
    grouped.set(row.category, group);
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
    throw createServiceError(400, '업로드할 이미지를 첨부해주세요.');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const archive = await findMyArchiveForImage(userId, parsedArchiveId, client);

    if (!archive) {
      throw createServiceError(404, '아카이브를 찾을 수 없습니다.');
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
      throw createServiceError(400, '아카이브 이미지는 최대 3장까지 업로드할 수 있습니다.');
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
    throw createServiceError(404, '아카이브를 찾을 수 없습니다.');
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
    throw createServiceError(404, '아카이브 이미지를 찾을 수 없습니다.');
  }
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
  getMySulbti,
  saveMySulbti,
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
  mapArchiveResponse,
  validateArchivePayload,
  validateTagIds,
};
