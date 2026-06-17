const crypto = require('crypto');
const pool = require('../config/db');
const { uploadFileToS3 } = require('../services/s3.service');
const {
  isAiFundingRegistrationStatus,
  registerFundingProjectToAiPool,
  KST_TIMEZONE,
} = require('../services/funding.service');
const {
  generateFundingDraftAiImageAndUpload,
  requestBreweryLicenseOcr,
  updateAiTasteProfile,
} = require('../services/ai.service');
const {
  getKstToday,
  isFundingSupportable,
} = require('../services/fundingSettlement.service');

const AI_TASTE_RATING_KEYS = [
  'sweetness',
  'body',
  'carbonation',
  'flavor',
  'alcohol',
  'acidity',
  'aroma_intensity',
  'finish',
];

const getBodyValue = (body, keys) => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      return body[key];
    }
  }

  return undefined;
};

const toRequiredBoolean = (value) =>
  value === true || value === 'true' || value === 1 || value === '1';

const toNullableNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const parseOptionalBoolean = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value === 1;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }

  return Boolean(value);
};

const toTrimmedString = (value) => {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
};

const extractZonecodeFromAddress = (address) => {
  const match = toTrimmedString(address).match(/^\[(\d{5})\]/);
  return match ? match[1] : null;
};

const parseJsonArrayField = (value, fallback = []) => {
  if (!value) return fallback;
  if (Array.isArray(value)) return value;

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === 'string' && parsed.trim()) return [parsed.trim()];
      return fallback;
    } catch (error) {
      return value.trim() ? [value.trim()] : fallback;
    }
  }

  return fallback;
};

const parseJsonField = (value, fallback = []) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
};

const parseJsonFieldPreserveText = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
};

const parseFundingListField = (value, fallback = []) => {
  if (value === undefined || value === null || value === '') return fallback;

  const normalizeList = (items) =>
    items
      .map((item) => toTrimmedString(item))
      .filter(Boolean);

  if (Array.isArray(value)) {
    return normalizeList(value);
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return normalizeList(parsed);
      if (typeof parsed === 'string') return parseFundingListField(parsed, fallback);
      return fallback;
    } catch (error) {
      return normalizeList(value.split(','));
    }
  }

  return fallback;
};

const normalizeRawMaterialItem = (material) => {
  if (material === undefined || material === null || material === '') {
    return null;
  }

  if (typeof material !== 'object' || Array.isArray(material)) {
    const name = toTrimmedString(material);
    return name ? { name, origin: null } : null;
  }

  const name = toTrimmedString(
    material.name
      ?? material.ingredient
      ?? material.mainIngredient
      ?? material.main_ingredient
      ?? material.rawMaterial
      ?? material.raw_material
  );
  const origin = toTrimmedString(
    material.origin
      ?? material.originName
      ?? material.origin_name
      ?? material.countryOfOrigin
      ?? material.country_of_origin
      ?? material.country
      ?? material.region
  );

  if (!name && !origin) {
    return null;
  }

  return {
    ...material,
    name: name || null,
    origin: origin || null,
  };
};

const parseFundingRawMaterialsField = (value, fallback = []) => {
  if (value === undefined || value === null || value === '') return fallback;

  if (Array.isArray(value)) {
    const materials = value.map(normalizeRawMaterialItem).filter(Boolean);
    return materials.length > 0 ? materials : fallback;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parseFundingRawMaterialsField(parsed, fallback);
    } catch (error) {
      const name = toTrimmedString(value);
      return name ? [{ name, origin: null }] : fallback;
    }
  }

  if (typeof value === 'object') {
    const material = normalizeRawMaterialItem(value);
    return material ? [material] : fallback;
  }

  return fallback;
};

const normalizeRawMaterialsStorageValue = (value) =>
  JSON.stringify(parseFundingRawMaterialsField(value, []));

const stringifyJsonField = (value, fallback = []) => {
  if (value === undefined || value === null) {
    return JSON.stringify(fallback);
  }

  return typeof value === 'string' ? value : JSON.stringify(value);
};

const normalizeJsonStorageValue = (value, fallback = []) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return JSON.stringify(fallback);
  }

  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch (error) {
      return JSON.stringify(parseFundingListField(value, fallback));
    }
  }

  return JSON.stringify(value);
};

const normalizeOriginalTextField = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return typeof value === 'string' ? value : JSON.stringify(value);
};

const parseOriginalTextField = (value, fallback = null) => {
  const parsed = parseJsonFieldPreserveText(value, fallback);

  return Array.isArray(parsed) && parsed.length === 0 ? fallback : parsed;
};

const selectProjectPolicyText = (refundPolicyValue, exchangePolicyValue) => {
  const refundPolicy = parseOriginalTextField(refundPolicyValue);
  const exchangePolicy = parseOriginalTextField(exchangePolicyValue);

  if (refundPolicy === null || refundPolicy === undefined || refundPolicy === '') {
    return exchangePolicy ?? null;
  }

  if (exchangePolicy === null || exchangePolicy === undefined || exchangePolicy === '') {
    return refundPolicy;
  }

  if (
    typeof refundPolicy === 'string' &&
    typeof exchangePolicy === 'string' &&
    refundPolicy !== exchangePolicy
  ) {
    const trimmedRefundPolicy = refundPolicy.trim();
    const trimmedExchangePolicy = exchangePolicy.trim();

    if (trimmedRefundPolicy && trimmedExchangePolicy) {
      if (trimmedRefundPolicy.includes(trimmedExchangePolicy)) {
        return exchangePolicy;
      }

      if (trimmedExchangePolicy.includes(trimmedRefundPolicy)) {
        return refundPolicy;
      }
    }
  }

  return refundPolicy;
};

const getUserId = (req) => {
  const userId = Number(req.user?.userId || req.user?.id);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
};

const requireUserId = (req, res) => {
  const userId = getUserId(req);

  if (!userId) {
    res.status(401).json({
      status: 401,
      message: '로그인이 필요합니다.',
    });
    return null;
  }

  return userId;
};

const FUNDING_OWNER_FORBIDDEN_MESSAGE = '해당 펀딩에 접근할 권한이 없습니다.';
const AUTH_REQUIRED_MESSAGE = '로그인이 필요합니다.';

const createHttpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const getAuthUserId = (user) => {
  const userId = Number(user?.userId || user?.id);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
};

const getAuthUserRole = (user) =>
  toTrimmedString(user?.role || user?.userRole || user?.type).toUpperCase();

const isAdminUser = (user) => getAuthUserRole(user) === 'ADMIN';

const findPaidFundingOrder = async (fundingId, userId) => {
  if (!fundingId || !userId) {
    return null;
  }

  const { rows } = await pool.query(
    `
    SELECT order_id
    FROM orders
    WHERE funding_id = $1
      AND user_id = $2
      AND order_status = 'PAID'
    ORDER BY updated_at DESC, created_at DESC, order_id DESC
    LIMIT 1
    `,
    [Number(fundingId), Number(userId)]
  );

  return rows[0] || null;
};

const findFundingReviewByUser = async (fundingId, userId) => {
  if (!fundingId || !userId) {
    return null;
  }

  const { rows } = await pool.query(
    `
    SELECT review_id
    FROM funding_reviews
    WHERE funding_id = $1
      AND user_id = $2
    ORDER BY created_at DESC, review_id DESC
    LIMIT 1
    `,
    [Number(fundingId), Number(userId)]
  );

  return rows[0] || null;
};

const getFundingReviewWriteState = async (fundingId, userId) => {
  const paidOrder = await findPaidFundingOrder(fundingId, userId);
  const existingReview = await findFundingReviewByUser(fundingId, userId);

  return {
    paidOrder,
    existingReview,
    canWriteReview: Boolean(paidOrder) && !existingReview,
  };
};

const canWriteFundingReview = async (fundingId, userId) => {
  const { canWriteReview } = await getFundingReviewWriteState(fundingId, userId);
  return canWriteReview;
};

const handleAuthorizationError = (res, error) => {
  if (![401, 403, 404].includes(error.status)) {
    return false;
  }

  res.status(error.status).json({
    status: error.status,
    message: error.message,
  });
  return true;
};

const assertFundingProjectOwner = async (fundingId, user) => {
  const userId = getAuthUserId(user);

  if (!userId) {
    throw createHttpError(401, AUTH_REQUIRED_MESSAGE);
  }

  const { rows } = await pool.query(
    `
    SELECT funding_id, brewery_user_id, status
    FROM funding_projects
    WHERE funding_id = $1
    `,
    [Number(fundingId)]
  );

  if (rows.length === 0) {
    throw createHttpError(404, '펀딩 프로젝트를 찾을 수 없습니다.');
  }

  const funding = rows[0];

  if (isAdminUser(user) || Number(funding.brewery_user_id) === userId) {
    return funding;
  }

  throw createHttpError(403, FUNDING_OWNER_FORBIDDEN_MESSAGE);
};

const normalizeOptionalFundingId = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const fundingId = Number(value);
  return Number.isInteger(fundingId) && fundingId > 0 ? fundingId : null;
};

const getRequestedFundingIdFromRequest = (req) => (
  normalizeOptionalFundingId(
    getBodyValue(req.body || {}, ['fundingId', 'funding_id'])
      ?? req.query?.fundingId
      ?? req.query?.funding_id
  )
);

const assertFundingDraftOwner = async (draftId, user, expectedFundingId = null) => {
  const userId = getAuthUserId(user);

  if (!userId) {
    throw createHttpError(401, AUTH_REQUIRED_MESSAGE);
  }

  const { rows } = await pool.query(
    `
    SELECT draft_id, brewery_id, funding_id
    FROM funding_drafts
    WHERE draft_id = $1
    `,
    [Number(draftId)]
  );

  if (rows.length === 0) {
    throw createHttpError(404, '펀딩 임시저장을 찾을 수 없습니다.');
  }

  const draft = rows[0];
  const normalizedExpectedFundingId = normalizeOptionalFundingId(expectedFundingId);

  if (
    normalizedExpectedFundingId !== null &&
    (
      draft.funding_id === null ||
      draft.funding_id === undefined ||
      Number(draft.funding_id) !== normalizedExpectedFundingId
    )
  ) {
    throw createHttpError(403, '접근 권한이 없습니다.');
  }

  if (isAdminUser(user) || Number(draft.brewery_id) === userId) {
    return draft;
  }

  throw createHttpError(403, FUNDING_OWNER_FORBIDDEN_MESSAGE);
};

const authorizeFundingProjectOwner = async (fundingId, user, res) => {
  try {
    await assertFundingProjectOwner(fundingId, user);
    return true;
  } catch (error) {
    if (handleAuthorizationError(res, error)) {
      return false;
    }

    throw error;
  }
};

const authorizeFundingDraftOwner = async (draftId, user, res, expectedFundingId = null) => {
  try {
    await assertFundingDraftOwner(draftId, user, expectedFundingId);
    return true;
  } catch (error) {
    if (handleAuthorizationError(res, error)) {
      return false;
    }

    throw error;
  }
};

const authorizeBreweryUserId = (breweryId, user, res) => {
  const userId = getAuthUserId(user);

  if (!userId) {
    res.status(401).json({
      status: 401,
      message: AUTH_REQUIRED_MESSAGE,
    });
    return false;
  }

  if (isAdminUser(user) || Number(breweryId) === userId) {
    return true;
  }

  res.status(403).json({
    status: 403,
    message: FUNDING_OWNER_FORBIDDEN_MESSAGE,
  });
  return false;
};

const uniqueValues = (values) => [
  ...new Set(
    (values || [])
      .filter((value) => typeof value === 'string' && value.trim() !== '')
      .map((value) => value.trim())
  ),
];

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

const normalizeAiTasteNumber = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
};

const parseAiTasteRatingsSource = (ratings) => {
  if (!ratings) {
    return {};
  }

  if (typeof ratings === 'string') {
    try {
      const parsed = JSON.parse(ratings);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch (error) {
      return {};
    }
  }

  return typeof ratings === 'object' && !Array.isArray(ratings)
    ? ratings
    : {};
};

const extractAiTasteRatings = (payload = {}) => {
  const ratingsSource = parseAiTasteRatingsSource(payload.ratings);
  const ratings = {};

  AI_TASTE_RATING_KEYS.forEach((key) => {
    const value = hasOwn(payload, key)
      ? payload[key]
      : ratingsSource[key];
    const normalized = normalizeAiTasteNumber(value);

    if (normalized !== undefined) {
      ratings[key] = normalized;
    }
  });

  return ratings;
};

const normalizeAiTasteTags = (value) => {
  if (value === undefined || value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeAiTasteTags(item));
  }

  if (typeof value === 'object') {
    return normalizeAiTasteTags(value.name || value.tagName || value.label);
  }

  const stringValue = String(value).trim();

  if (!stringValue) {
    return [];
  }

  if (stringValue.startsWith('[')) {
    try {
      const parsed = JSON.parse(stringValue);
      return Array.isArray(parsed) ? normalizeAiTasteTags(parsed) : [];
    } catch (error) {
      return [stringValue];
    }
  }

  return stringValue
    .split(',')
    .map((tagName) => tagName.trim())
    .filter(Boolean);
};

const shouldUpdateReviewAiTaste = (requestBody = {}, isCreate = false) => {
  if (Object.keys(extractAiTasteRatings(requestBody)).length > 0) {
    return true;
  }

  return isCreate || hasOwn(requestBody, 'rating');
};

const updateFundingReviewAiTasteProfile = async ({
  userId,
  review,
  requestBody,
  isCreate = false,
}) => {
  if (!shouldUpdateReviewAiTaste(requestBody, isCreate)) {
    return null;
  }

  const rating = normalizeAiTasteNumber(review.rating);
  const ratings = extractAiTasteRatings(requestBody);

  if (rating === undefined && Object.keys(ratings).length === 0) {
    return null;
  }

  const tagNames = [
    ...normalizeAiTasteTags(review.tags),
    ...normalizeAiTasteTags(requestBody.customTags),
    ...normalizeAiTasteTags(requestBody.tagNames),
  ];
  const aiPayload = {
    user_id: String(userId),
    drink_id: review.funding_id ? `funding_${review.funding_id}` : `review_${review.review_id}`,
    tags: [...new Set(tagNames)],
  };

  if (rating !== undefined) {
    aiPayload.rating = rating;
  }

  if (Object.keys(ratings).length > 0) {
    aiPayload.ratings = ratings;
  }

  return updateAiTasteProfile(aiPayload);
};

const normalizePublicImageUrl = (imageUrl) => {
  const trimmed = toTrimmedString(imageUrl);

  if (!trimmed) {
    return null;
  }

  if (/^(file|content):\/\//i.test(trimmed)) {
    return null;
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
};

const normalizeFundingImageUrlsInput = (value) => {
  if (value === undefined || value === null || value === '') {
    return [];
  }

  const normalizeItem = (item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return item.imageUrl || item.image_url || item.url || '';
    }

    return item;
  };

  if (Array.isArray(value)) {
    return uniqueValues(
      value
        .map(normalizeItem)
        .map(normalizePublicImageUrl)
        .filter(Boolean)
    );
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return normalizeFundingImageUrlsInput(parsed);
    } catch (error) {
      return uniqueValues(
        value
          .split(',')
          .map((imageUrl) => normalizePublicImageUrl(imageUrl))
          .filter(Boolean)
      );
    }
  }

  return [];
};

const parseReviewStringArrayField = (value, fieldName) => {
  const invalidMessage = `${fieldName} 값이 올바르지 않습니다.`;

  const normalizeItems = (items) => {
    if (!Array.isArray(items)) {
      throw createHttpError(400, invalidMessage);
    }

    return items
      .map((item) => {
        if (item === undefined || item === null) {
          return '';
        }

        if (typeof item === 'object') {
          throw createHttpError(400, invalidMessage);
        }

        return String(item).trim();
      })
      .filter(Boolean);
  };

  if (value === undefined || value === null || value === '') {
    return [];
  }

  if (Array.isArray(value)) {
    return normalizeItems(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (!trimmed) {
      return [];
    }

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return normalizeItems(JSON.parse(trimmed));
      } catch (error) {
        if (error.status) {
          throw error;
        }

        throw createHttpError(400, invalidMessage);
      }
    }

    return normalizeItems(trimmed.split(','));
  }

  throw createHttpError(400, invalidMessage);
};

const normalizeReviewTagsInput = (value) =>
  uniqueValues(parseReviewStringArrayField(value, 'tags'));

const normalizeReviewImageUrlsInput = (value, fieldName = 'imageUrls') =>
  uniqueValues(
    parseReviewStringArrayField(value, fieldName)
      .map(normalizePublicImageUrl)
      .filter(Boolean)
  );

const REVIEW_RATING_ERROR_MESSAGE = 'rating은 0~5 사이에서 0.5 단위로 입력해주세요.';

const normalizeReviewRatingInput = (value, { required = false } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw createHttpError(400, REVIEW_RATING_ERROR_MESSAGE);
    }

    return null;
  }

  const numberValue = Number(value);

  if (
    !Number.isFinite(numberValue) ||
    numberValue < 0 ||
    numberValue > 5 ||
    !Number.isInteger(numberValue * 2)
  ) {
    throw createHttpError(400, REVIEW_RATING_ERROR_MESSAGE);
  }

  return Math.round(numberValue * 10) / 10;
};

const buildImageFields = (thumbnailUrl, imageUrlsValue) => {
  const parsedImageUrls = normalizeFundingImageUrlsInput(imageUrlsValue);
  const normalizedThumbnailUrl = normalizePublicImageUrl(thumbnailUrl) || parsedImageUrls[0] || null;
  const additionalImageUrls = parsedImageUrls.filter((imageUrl) => imageUrl !== normalizedThumbnailUrl);
  const allImageUrls = uniqueValues([normalizedThumbnailUrl, ...additionalImageUrls].filter(Boolean)).slice(0, 5);

  return {
    thumbnailUrl: normalizedThumbnailUrl,
    imageUrls: allImageUrls,
    additionalImageUrls,
    allImageUrls,
  };
};

const mapFundingImageUrls = (imageUrls = []) =>
  (imageUrls || []).slice(0, 5).map((imageUrl, index) => ({
    imageId: index + 1,
    imageUrl,
    displayOrder: index + 1,
  }));

const normalizePublicProfileText = (value) => {
  const text = toTrimmedString(value);
  return text || null;
};

const toNullableProfileNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const buildPublicBreweryProfile = (row = {}) => {
  const breweryUserId = row.brewery_user_id === null || row.brewery_user_id === undefined
    ? null
    : Number(row.brewery_user_id);
  const breweryName = normalizePublicProfileText(
    row.brewery_name ||
      row.profile_brewery_name ||
      row.auth_brewery_name ||
      row.brewery_nickname
  );
  const profileImageUrl = normalizePublicImageUrl(row.profile_image_url) || null;
  const oneLineIntroduction = normalizePublicProfileText(row.one_line_introduction);
  const shortIntroduction = normalizePublicProfileText(row.short_introduction || oneLineIntroduction);
  const brandStory = normalizePublicProfileText(row.brand_story);
  const history = normalizePublicProfileText(row.history);
  const description = shortIntroduction || oneLineIntroduction || brandStory || history;
  const establishedYear = toNullableProfileNumber(row.established_year);
  const businessRegistrationNumber = normalizePublicProfileText(row.business_registration_number);
  const representativeName = normalizePublicProfileText(row.representative_name);
  const address = normalizePublicProfileText(row.profile_address || row.auth_location);
  const businessAddressDetail = normalizePublicProfileText(row.auth_business_address_detail);

  return {
    breweryUserId,
    breweryName,
    mainName: breweryName,
    profileImageUrl,
    profile_image_url: profileImageUrl,
    profileImage: profileImageUrl,
    profile_image: profileImageUrl,
    imageUrl: profileImageUrl,
    image_url: profileImageUrl,
    oneLineIntroduction,
    one_line_introduction: oneLineIntroduction,
    shortIntroduction,
    short_introduction: shortIntroduction,
    creatorIntroduction: description,
    creator_introduction: description,
    breweryBio: description,
    brewery_bio: description,
    introduction: description,
    bio: description,
    description,
    brandStory,
    brand_story: brandStory,
    history,
    establishedYear,
    established_year: establishedYear,
    businessRegistrationNumber,
    business_registration_number: businessRegistrationNumber,
    representativeName,
    representative_name: representativeName,
    address,
    businessAddress: address,
    business_address: address,
    businessAddressDetail,
    business_address_detail: businessAddressDetail,
  };
};

const extractFundingAiImageFlavorTags = (value) => {
  const parsed = parseJsonFieldPreserveText(value, null);

  if (Array.isArray(parsed) || typeof parsed === 'string') {
    return parseFundingListField(parsed);
  }

  if (parsed && typeof parsed === 'object') {
    return parseFundingListField(
      parsed.flavorTags ||
      parsed.flavor_tags ||
      parsed.flavorNotes ||
      parsed.flavor_notes ||
      []
    );
  }

  return [];
};

const normalizeFundingAiImagePayload = (body = {}, draft = {}) => {
  const requestFlavorTags = getBodyValue(body, ['flavorTags', 'flavor_tags']);
  const flavorTags = requestFlavorTags !== undefined
    ? parseFundingListField(requestFlavorTags)
    : uniqueValues([
        ...extractFundingAiImageFlavorTags(draft.flavor_notes),
        ...parseFundingListField(draft.tags),
      ]);
  const requestMainIngredient = getBodyValue(body, ['mainIngredient', 'main_ingredient']);
  const mainIngredient = toTrimmedString(
    requestMainIngredient !== undefined ? requestMainIngredient : draft.main_ingredient
  );
  const requestSubIngredients = getBodyValue(body, ['subIngredients', 'sub_ingredients']);
  const subIngredients = requestSubIngredients !== undefined
    ? parseFundingListField(requestSubIngredients)
    : parseFundingListField(draft.sub_ingredients);
  const requestTasteVector = getBodyValue(body, ['taste_vector', 'tasteVector']);
  const draftTasteVector = parseTasteProfileExtras(draft.flavor_notes).tasteVector;
  const tasteVector = requestTasteVector !== undefined ? requestTasteVector : draftTasteVector;
  const seed = getBodyValue(body, ['seed', 'imageSeed']);
  const concept = toTrimmedString(getBodyValue(body, ['concept']));

  return {
    name: toTrimmedString(
      getBodyValue(body, ['name']) ||
      draft.title ||
      draft.short_title
    ),
    description: toTrimmedString(
      getBodyValue(body, ['description']) ||
      draft.summary ||
      draft.introduction
    ),
    flavor_tags: flavorTags,
    region: toTrimmedString(
      getBodyValue(body, ['region']) ||
      draft.region ||
      draft.business_address
    ),
    ...(mainIngredient ? { main_ingredient: mainIngredient } : {}),
    ...(subIngredients.length > 0 ? { sub_ingredients: subIngredients } : {}),
    ...(concept ? { concept } : {}),
    ...(tasteVector ? { taste_vector: tasteVector } : {}),
    ...(seed !== undefined && seed !== null && seed !== '' ? { seed } : {}),
  };
};

const buildFundingSupportOptionsResponse = ({
  options = [],
  funding = {},
  mainIngredient = null,
  subIngredients = [],
  ingredients = [],
}) => {
  const mappedOptions = (options || []).map((option) => ({
    optionId: Number(option.option_id),
    name: option.name,
    price: Number(option.price || 0),
    description: option.description,
    volume: option.volume ?? funding.volume,
    alcohol: option.alcohol ?? funding.alcohol_percentage,
    alcoholPercentage: option.alcohol ?? funding.alcohol_percentage,
    expectedDeliveryDate: funding.expected_delivery_date,
    mainIngredient,
    primaryIngredient: mainIngredient,
    subIngredient: subIngredients[0] || null,
    subIngredients,
    ingredients,
    stock: option.stock,
    remainingStock: option.remaining_stock,
    maxPerUser: option.max_per_user,
    generated: false,
  }));

  if (mappedOptions.length > 0) {
    return mappedOptions;
  }

  const fallbackPrice = Number(funding.price_per_bottle);

  if (!Number.isFinite(fallbackPrice) || fallbackPrice <= 0) {
    return [];
  }

  return [{
    optionId: null,
    name: '기본 후원 옵션',
    price: fallbackPrice,
    description: funding.summary || funding.description || null,
    volume: funding.volume ?? null,
    alcohol: funding.alcohol_percentage ?? null,
    alcoholPercentage: funding.alcohol_percentage ?? null,
    expectedDeliveryDate: funding.expected_delivery_date ?? null,
    mainIngredient,
    primaryIngredient: mainIngredient,
    subIngredient: subIngredients[0] || null,
    subIngredients,
    ingredients,
    stock: funding.total_quantity ?? null,
    remainingStock: funding.total_quantity ?? null,
    maxPerUser: null,
    generated: true,
  }];
};

const MAIN_INGREDIENT_LABEL = '메인 재료';

const PLAN_GUIDES = {
  budgetPlanGuide: '예산 사용 계획을 구체적으로 작성해주세요.',
  schedulePlanGuide: '프로젝트 진행 및 배송 일정을 구체적으로 작성해주세요.',
};

const FUNDING_TEXT_FIXTURES = {
  3: {
    mainIngredient: '쌀',
    subIngredients: ['산사나무열매'],
    rawMaterials: [
      { name: '쌀', origin: '국내산' },
      { name: '산사나무열매', origin: '국내산' },
    ],
    flavorNotes: ['상큼하고 은은한 산사 향'],
    flavorTags: ['상큼하고 은은한 산사 향'],
  },
};

const hasBrokenKoreanText = (value) => {
  if (value === undefined || value === null) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(hasBrokenKoreanText);
  }

  if (typeof value === 'object') {
    return Object.values(value).some(hasBrokenKoreanText);
  }

  const text = String(value);
  return text.includes('\uFFFD') || text.includes('��');
};

const getFundingTextFixture = (fundingId) =>
  FUNDING_TEXT_FIXTURES[Number(fundingId)] || null;
const normalizeDisplayText = (value, fallback = null) => {
  const text = toTrimmedString(value);

  if (!text || hasBrokenKoreanText(text)) {
    return fallback;
  }

  return text;
};

const normalizeDisplayList = (value, fallback = []) => {
  const normalized = parseFundingListField(value)
    .map((item) => normalizeDisplayText(item))
    .filter(Boolean);

  return normalized.length > 0 ? normalized : fallback;
};

const normalizeDisplayRawMaterials = (value, fallback = []) => {
  const normalized = parseFundingRawMaterialsField(value)
    .map((material) => ({
      ...material,
      name: normalizeDisplayText(material.name),
      origin: normalizeDisplayText(material.origin),
    }))
    .filter((material) => material.name || material.origin);

  return normalized.length > 0 ? normalized : fallback;
};

const buildFundingIngredientContext = (funding = {}) => {
  const fixture = getFundingTextFixture(funding.funding_id);
  const mainIngredient = normalizeDisplayText(
    funding.main_ingredient || funding.recipe_main_ingredient,
    fixture?.mainIngredient || null,
  );
  const subIngredients = normalizeDisplayList(
    funding.sub_ingredients || funding.recipe_sub_ingredient,
    fixture?.subIngredients || [],
  );
  const rawMaterials = normalizeDisplayRawMaterials(
    funding.raw_materials,
    fixture?.rawMaterials || [],
  );
  const ingredientNames = rawMaterials
    .map((material) => material.name)
    .filter(Boolean);
  const ingredients = uniqueValues([
    mainIngredient,
    ...subIngredients,
    ...ingredientNames,
  ].filter(Boolean));

  return {
    mainIngredient,
    primaryIngredient: mainIngredient,
    subIngredient: subIngredients[0] || null,
    subIngredients,
    ingredients,
    rawMaterials,
    ingredientDetails: rawMaterials,
  };
};

const parseTasteProfileExtras = (flavorNotesValue) => {
  const parsed = parseJsonFieldPreserveText(flavorNotesValue, []);

  if (Array.isArray(parsed)) {
    return {
      flavorNotes: parsed,
      flavorTags: parsed,
      flavor: null,
      aromaIntensity: null,
      finish: null,
      tasteInput: null,
      tasteVector: null,
    };
  }

  if (parsed && typeof parsed === 'object') {
    const flavorTags = parseJsonArrayField(parsed.flavorTags || parsed.flavor_tags || parsed.flavorNotes);

    return {
      flavorNotes: parseJsonArrayField(parsed.flavorNotes || parsed.flavor_notes || flavorTags),
      flavorTags,
      flavor: toNullableNumber(parsed.flavor),
      aromaIntensity: toNullableNumber(parsed.aromaIntensity ?? parsed.aroma_intensity),
      finish: toNullableNumber(parsed.finish ?? parsed.aftertaste),
      tasteInput: parsed.tasteInput || parsed.taste_input || null,
      tasteVector: parsed.tasteVector || parsed.taste_vector || null,
    };
  }

  const text = toTrimmedString(parsed);
  const values = text ? [text] : [];

  return {
    flavorNotes: values,
    flavorTags: values,
    flavor: null,
    aromaIntensity: null,
    finish: null,
    tasteInput: null,
    tasteVector: null,
  };
};

const buildTasteProfileStorage = ({
  flavorNotes,
  flavorTags,
  flavor,
  aromaIntensity,
  finish,
  tasteInput,
  tasteVector,
}) => {
  const tags = uniqueValues([
    ...parseJsonArrayField(flavorNotes),
    ...parseJsonArrayField(flavorTags),
  ]);
  const hasExtraTasteFields = [flavor, aromaIntensity, finish, tasteInput, tasteVector]
    .some((value) => value !== undefined && value !== null && value !== '');

  if (!hasExtraTasteFields) {
    return JSON.stringify(tags);
  }

  return JSON.stringify({
    flavorTags: tags,
    flavor: toNullableNumber(flavor),
    aromaIntensity: toNullableNumber(aromaIntensity),
    finish: toNullableNumber(finish),
    tasteInput: tasteInput || null,
    tasteVector: tasteVector || null,
  });
};

const buildTasteProfileResponse = (source = {}) => {
  const extras = parseTasteProfileExtras(source.flavor_notes);
  const alcoholIntensity = source.alcohol_intensity ?? source.alcoholIntensity ?? null;
  const fixture = getFundingTextFixture(source.funding_id || source.fundingId);
  const flavorNotes = normalizeDisplayList(extras.flavorNotes, fixture?.flavorNotes || []);
  const flavorTags = normalizeDisplayList(extras.flavorTags, fixture?.flavorTags || flavorNotes);

  return {
    abv: source.alcohol_percentage ?? source.abv ?? null,
    alcohol: alcoholIntensity,
    alcoholPercentage: source.alcohol_percentage ?? source.alcoholPercentage ?? null,
    sweetness: source.sweetness,
    acidity: source.acidity,
    body: source.body,
    carbonation: source.carbonation,
    alcoholIntensity,
    flavor: source.flavor ?? extras.flavor,
    aromaIntensity: source.aroma_intensity ?? source.aromaIntensity ?? extras.aromaIntensity,
    finish: source.finish ?? source.aftertaste ?? extras.finish,
    aftertaste: source.aftertaste ?? source.finish ?? extras.finish,
    flavorNotes,
    flavorTags,
    tasteInput: extras.tasteInput || {
      sweetness: source.sweetness,
      body: source.body,
      carbonation: source.carbonation,
      flavor: source.flavor ?? extras.flavor,
      alcohol: alcoholIntensity,
      alcoholIntensity,
      acidity: source.acidity,
      aromaIntensity: source.aroma_intensity ?? source.aromaIntensity ?? extras.aromaIntensity,
      aroma_intensity: source.aroma_intensity ?? source.aromaIntensity ?? extras.aromaIntensity,
      finish: source.finish ?? extras.finish,
      aftertaste: source.aftertaste ?? source.finish ?? extras.finish,
    },
    tasteVector: source.taste_vector ?? source.tasteVector ?? extras.tasteVector,
  };
};

const getNullableUserId = (req) => {
  return getUserId(req);
};

const createBankVerificationCode = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

const createBankVerificationToken = () => crypto.randomBytes(32).toString('hex');

const getBankVerificationTtlMinutes = () => {
  const ttl = Number(process.env.BANK_ACCOUNT_VERIFICATION_TTL_MINUTES || 10);
  return Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 10;
};

const shouldExposeBankVerificationCode = () =>
  process.env.BANK_ACCOUNT_VERIFICATION_EXPOSE_CODE === 'true'
  || process.env.NODE_ENV !== 'production';

const normalizeComparableAccountNumber = (accountNumber) =>
  toTrimmedString(accountNumber).replace(/\D/g, '');

const getBankVerificationFields = (body = {}) => ({
  bankName: toTrimmedString(getBodyValue(body, ['bankName', 'bank_name'])),
  accountNumber: normalizeComparableAccountNumber(
    getBodyValue(body, ['accountNumber', 'account_number'])
  ),
  normalizedAccountNumber: normalizeComparableAccountNumber(
    getBodyValue(body, ['accountNumber', 'account_number'])
  ),
  accountHolder: toTrimmedString(getBodyValue(body, ['accountHolder', 'account_holder'])),
});

const normalizeWriterRole = (role) => toTrimmedString(role || 'USER').toUpperCase() || 'USER';

const isBreweryWriterRole = (role) => normalizeWriterRole(role).startsWith('BREWERY');

const normalizeSulbtiScore = (score) => {
  const numberScore = Number(score);
  if (!Number.isFinite(numberScore)) return null;
  return Math.max(0, Math.min(100, (numberScore - 1) * 25));
};

const normalizeFundingMatchScore = (score, fallback = 0) => {
  const numberScore = Number(score);
  if (!Number.isFinite(numberScore)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numberScore)));
};

const calculateSulbtiMatchScore = (sulbti, taste) => {
  if (!sulbti || !taste) return 0;

  const axes = [
    [normalizeSulbtiScore(sulbti.sweetness_score), taste.sweetness],
    [normalizeSulbtiScore(sulbti.body_score), taste.body],
    [normalizeSulbtiScore(sulbti.carbonation_score), taste.carbonation],
    [normalizeSulbtiScore(sulbti.abv_score), taste.alcohol_intensity],
  ].filter(([preferred, actual]) => preferred !== null && Number.isFinite(Number(actual)));

  if (axes.length === 0) return 0;

  const total = axes.reduce((sum, [preferred, actual]) => (
    sum + Math.max(0, 100 - Math.abs(preferred - Number(actual)))
  ), 0);

  return normalizeFundingMatchScore(total / axes.length);
};

const mapFundingDocument = (document) => ({
  documentId: Number(document.document_id),
  draftId: Number(document.draft_id),
  documentType: document.document_type,
  fileName: document.file_name,
  fileUrl: document.file_url,
  mimeType: document.mime_type,
  fileSize: document.file_size === null || document.file_size === undefined
    ? null
    : Number(document.file_size),
  ocrStatus: document.ocr_status || null,
  ocrSummary: document.ocr_summary || null,
  ocrExtractedFields: parseJsonField(document.ocr_extracted_fields, null),
  ocrResult: parseJsonField(document.ocr_result, null),
  ocrProcessedAt: document.ocr_processed_at || null,
  createdAt: document.created_at,
});

const mapReviewImageUrls = (value) => {
  try {
    return normalizeReviewImageUrlsInput(value);
  } catch (error) {
    return [];
  }
};

const mapReviewTags = (value) => {
  try {
    return normalizeReviewTagsInput(value);
  } catch (error) {
    return [];
  }
};

const mapFundingReview = (review) => {
  const writerId = review.user_id === null || review.user_id === undefined
    ? null
    : Number(review.user_id);
  const imageUrls = mapReviewImageUrls(review.image_urls);
  const writerIsBrewery = isBreweryWriterRole(review.writer_role);
  const isProjectOwner = toRequiredBoolean(review.is_project_owner);

  return {
    reviewId: Number(review.review_id),
    fundingId: Number(review.funding_id),
    writerId,
    writer_id: writerId,
    userId: writerId,
    user_id: writerId,
    writerNickname: review.writer_nickname || '익명',
    writerProfileImage: review.writer_profile_image || null,
    profileImage: review.writer_profile_image || null,
    writerRole: normalizeWriterRole(review.writer_role),
    role: normalizeWriterRole(review.writer_role),
    isBrewery: writerIsBrewery,
    writerIsBrewery,
    isProjectOwner,
    showBreweryBadge: isProjectOwner,
    breweryBadge: isProjectOwner,
    rating: Number(review.rating),
    title: review.title,
    content: review.content,
    detailReview: review.content,
    imageUrls,
    images: imageUrls.map((imageUrl, index) => ({
      imageId: index + 1,
      imageUrl,
      displayOrder: index + 1,
    })),
    mood: review.mood,
    pairing: review.pairing,
    tags: mapReviewTags(review.tags),
    recordVisibility: review.record_visibility,
    showRecord: review.record_visibility,
    likeCount: Number(review.like_count || 0),
    liked: Boolean(review.liked),
    createdAt: review.created_at,
    updatedAt: review.updated_at,
  };
};

const buildFundingReviewResponse = ({ status, message, review, aiTasteUpdate = null }) => {
  const data = {
    ...mapFundingReview(review),
    ...(aiTasteUpdate ? { aiTasteUpdate } : {}),
  };

  return {
    ...data,
    status,
    message,
    data,
  };
};

const mapFundingReviewComment = (comment) => {
  const writerId = comment.user_id === null || comment.user_id === undefined
    ? null
    : Number(comment.user_id);
  const writerIsBrewery = isBreweryWriterRole(comment.writer_role);
  const isProjectOwner = toRequiredBoolean(comment.is_project_owner);

  return {
    commentId: Number(comment.comment_id),
    fundingId: Number(comment.funding_id),
    reviewId: Number(comment.review_id),
    writerId,
    writer_id: writerId,
    userId: writerId,
    user_id: writerId,
    writerNickname: comment.writer_nickname || '익명',
    writerProfileImage: comment.writer_profile_image || null,
    profileImage: comment.writer_profile_image || null,
    writerRole: normalizeWriterRole(comment.writer_role),
    role: normalizeWriterRole(comment.writer_role),
    isBrewery: writerIsBrewery,
    writerIsBrewery,
    isProjectOwner,
    showBreweryBadge: isProjectOwner,
    breweryBadge: isProjectOwner,
    content: comment.content,
    likeCount: Number(comment.like_count || 0),
    liked: Boolean(comment.liked),
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
  };
};

const resolveFundingId = async (id) => {
  if (!id || isNaN(Number(id))) {
    return null;
  }

  const numericId = Number(id);
  const directResult = await pool.query(
    `
    SELECT funding_id
    FROM funding_projects
    WHERE funding_id = $1
    `,
    [numericId]
  );

  if (directResult.rows.length > 0) {
    return Number(directResult.rows[0].funding_id);
  }

  const draftResult = await pool.query(
    `
    SELECT funding_id
    FROM funding_drafts
    WHERE draft_id = $1
    AND funding_id IS NOT NULL
    `,
    [numericId]
  );

  return draftResult.rows.length > 0
    ? Number(draftResult.rows[0].funding_id)
    : null;
};

const buildFundingDraftPayload = (draft, documents = []) => {
  const imageFields = buildImageFields(draft.thumbnail_url, draft.image_urls);
  const subIngredients = parseFundingListField(draft.sub_ingredients);
  const rawMaterials = parseFundingRawMaterialsField(draft.raw_materials);
  const tags = parseJsonField(draft.tags);
  const budgetPlan = parseOriginalTextField(draft.budget_plan);
  const schedulePlan = parseOriginalTextField(draft.schedule_plan);
  const businessNumber = draft.business_registration_number || draft.license_number || null;
  const tasteProfile = buildTasteProfileResponse(draft);
  const projectPolicy = selectProjectPolicyText(draft.refund_policy, draft.exchange_policy);
  const legalNotices = rawMaterials.length > 0
    ? rawMaterials
    : (draft.volume || draft.alcohol_percentage || draft.main_ingredient
      ? [{ name: draft.main_ingredient || null, origin: null }]
      : []);
  const mappedLegalNotices = legalNotices.map((material) => ({
    volume: draft.volume,
    alcoholDegree: draft.alcohol_percentage,
    alcoholContent: draft.alcohol_percentage,
    mainIngredient: material.name || material.mainIngredient || material.main_ingredient || draft.main_ingredient || null,
    origin: material.origin || material.countryOfOrigin || material.country_of_origin || material.region || null,
  }));
  const storyInfo = {
    introduction: draft.introduction,
    projectDescription: draft.introduction,
    budgetPlan,
    projectBudget: budgetPlan,
    videoUrl: draft.video_url,
    projectSchedule: schedulePlan,
    schedulePlan,
  };
  const taxInvoiceInfo = {
    businessClassification: draft.business_classification,
    businessType: draft.business_type,
    companyName: draft.business_name,
    businessName: draft.business_name,
    businessRegistrationNumber: draft.business_registration_number,
    representativeName: draft.representative_name,
    businessAddress: draft.business_address,
    businessCategory: draft.business_category,
    businessItem: draft.business_item,
    email: draft.tax_email,
    taxEmail: draft.tax_email,
    businessRegistrationFileUrl: draft.business_registration_file_url,
  };
  const noticeInfo = {
    projectPolicy,
    policy: projectPolicy,
    expectedDifficulties: draft.risk_notice,
    risks: draft.risk_notice,
    riskPlan: draft.risk_notice,
    riskNotice: draft.risk_notice,
  };

  return {
    draftId: Number(draft.draft_id),
    fundingId: draft.funding_id === null || draft.funding_id === undefined
      ? null
      : Number(draft.funding_id),
    breweryId: draft.brewery_id === null || draft.brewery_id === undefined
      ? null
      : Number(draft.brewery_id),
    status: draft.status,
    draftStatus: draft.status,
    fundingStatus: draft.funding_status || draft.fundingStatus || null,
    progressRate: Number(draft.progress_rate || 0),
    createdAt: draft.created_at,
    updatedAt: draft.updated_at,
    submittedAt: draft.submitted_at,

    basicInfo: {
      title: draft.title,
      shortTitle: draft.short_title,
      category: draft.category,
      description: draft.summary || draft.introduction || null,
      mainIngredient: draft.main_ingredient,
      subIngredient: Array.isArray(subIngredients) ? subIngredients[0] || null : subIngredients,
      subIngredients,
      alcoholDegree: draft.alcohol_percentage,
      alcoholContent: draft.alcohol_percentage,
      alcoholPercentage: draft.alcohol_percentage,
      summary: draft.summary,
      projectSummary: draft.summary,
      thumbnailUrl: imageFields.thumbnailUrl,
      representativeImageUrl: imageFields.thumbnailUrl,
      imageUrl: imageFields.thumbnailUrl,
      imageUrls: imageFields.imageUrls,
      allImageUrls: imageFields.allImageUrls,
      images: mapFundingImageUrls(imageFields.allImageUrls),
      searchTags: tags,
      tags,
      recipeId: draft.recipe_id === null || draft.recipe_id === undefined
        ? null
        : Number(draft.recipe_id),
    },

    schedule: {
      pricePerBottle: draft.price_per_bottle,
      totalQuantity: draft.total_quantity,
      targetAmount: draft.target_amount,
      goalAmount: draft.target_amount,
      fundingStartDate: draft.funding_start_date,
      startDate: draft.funding_start_date,
      fundingPeriodDays: draft.funding_period_days,
      projectDuration: draft.funding_period_days,
      fundingEndDate: draft.funding_end_date,
      endDate: draft.funding_end_date,
      expectedDeliveryDate: draft.expected_delivery_date,
      expectedDeliveryStartDate: draft.expected_delivery_date,
      scheduleSummary: draft.schedule_summary || null,
      platformFeeRate: draft.platform_fee_rate,
      platformFeeAmount: draft.platform_fee_amount,
      shippingFee: draft.shipping_fee,
      maxSupportAmount: draft.max_support_amount ?? null,
      minSupportAmount: draft.min_support_amount ?? null,
    },

    fundingInfo: {
      bottleUnitPrice: draft.price_per_bottle,
      unitPrice: draft.price_per_bottle,
      pricePerBottle: draft.price_per_bottle,
      totalSalesQuantity: draft.total_quantity,
      totalQuantity: draft.total_quantity,
      quantity: draft.total_quantity,
      targetAmount: draft.target_amount,
      startDate: draft.funding_start_date,
      fundingStartDate: draft.funding_start_date,
      projectDuration: draft.funding_period_days,
      fundingPeriodDays: draft.funding_period_days,
      endDate: draft.funding_end_date,
      fundingEndDate: draft.funding_end_date,
      expectedDeliveryStartDate: draft.expected_delivery_date,
      expectedDeliveryDate: draft.expected_delivery_date,
      scheduleSummary: draft.schedule_summary || null,
    },

    legalInfo: {
      productType: draft.product_type,
      volume: draft.volume,
      alcoholPercentage: draft.alcohol_percentage,
      rawMaterials,
      businessNumber,
      licenseNumber: businessNumber,
      businessAddress: draft.business_address || null,
      businessAddressDetail: draft.business_address_detail || null,
      notice: draft.adult_verification_notice || draft.risk_notice || null,
      policy: projectPolicy,
      refundPolicy: projectPolicy,
      exchangePolicy: projectPolicy,
      adultOnly: draft.adult_only ?? null,
      termsAgreed: draft.all_required_terms_agreed ?? null,
      privacyAgreed: draft.privacy_agreed ?? null,
    },

    legalNotices: mappedLegalNotices,

    tasteProfile,

    tasteGraph: {
      sweetness: tasteProfile.sweetness,
      aftertaste: tasteProfile.aftertaste,
      finish: tasteProfile.finish,
      acidity: tasteProfile.acidity,
      body: tasteProfile.body,
      carbonation: tasteProfile.carbonation,
    },

    plan: {
      introduction: draft.introduction,
      videoUrl: draft.video_url,
      productionPlan: draft.production_plan || draft.introduction || null,
      deliveryPlan: draft.delivery_plan || draft.expected_delivery_date || null,
      fundingPurpose: draft.funding_purpose || draft.introduction || null,
      budgetPlan,
      projectBudget: budgetPlan,
      riskPlan: draft.risk_plan || draft.risk_notice || null,
      schedulePlan,
      projectSchedule: schedulePlan,
      policy: projectPolicy,
      projectPolicy,
      ...PLAN_GUIDES,
    },

    storyInfo,

    breweryInfo: {
      breweryId: draft.brewery_id === null || draft.brewery_id === undefined
        ? null
        : Number(draft.brewery_id),
      breweryUserId: draft.brewery_id === null || draft.brewery_id === undefined
        ? null
        : Number(draft.brewery_id),
      breweryName: draft.brewery_name,
      breweryDescription: draft.creator_introduction,
      breweryLocation: draft.business_address,
      breweryAddress: draft.business_address,
      breweryPhone: draft.contact_phone,
      breweryImageUrl: draft.profile_image_url,
      creatorName: draft.creator_name,
      profileImageUrl: draft.profile_image_url,
      creatorIntroduction: draft.creator_introduction,
      breweryBio: draft.creator_introduction,
      contactPhone: draft.contact_phone,
      contactEmail: draft.contact_email,
      phoneVerified: draft.phone_verified,
      identityDocumentUrl: draft.identity_document_url,
      bankName: draft.bank_name,
      accountNumber: draft.account_number,
      accountHolder: draft.account_holder,
      accountVerified: draft.account_verified,
      businessClassification: draft.business_classification,
      businessType: draft.business_type,
      businessName: draft.business_name,
      representativeName: draft.representative_name,
      businessRegistrationNumber: draft.business_registration_number,
      businessAddress: draft.business_address,
      businessCategory: draft.business_category,
      businessItem: draft.business_item,
      taxEmail: draft.tax_email,
      businessRegistrationFileUrl: draft.business_registration_file_url,
    },

    taxInvoiceInfo,

    notices: {
      refundPolicy: projectPolicy,
      exchangePolicy: projectPolicy,
      adultVerificationNotice: draft.adult_verification_notice,
      riskNotice: draft.risk_notice,
      notice: draft.adult_verification_notice || draft.risk_notice || null,
      policy: projectPolicy,
    },

    noticeInfo,

    documents: documents.map(mapFundingDocument),
    images: mapFundingImageUrls(imageFields.allImageUrls),
  };
};

const getFundingDraftDocuments = async (draftId) => {
  const { rows } = await pool.query(
    `
    SELECT
      document_id,
      draft_id,
      document_type,
      file_name,
      file_url,
      mime_type,
      file_size,
      ocr_status,
      ocr_result,
      ocr_summary,
      ocr_extracted_fields,
      ocr_processed_at,
      created_at
    FROM funding_documents
    WHERE draft_id = $1
    ORDER BY document_id ASC
    `,
    [Number(draftId)]
  );

  return rows;
};

const findDirectFundingDraftByFundingId = async (fundingId) => {
  const { rows } = await pool.query(
    `
    SELECT fd.*
    FROM funding_drafts fd
    JOIN funding_projects fp ON fp.funding_id = fd.funding_id
    WHERE fd.funding_id = $1
      AND fd.brewery_id = fp.brewery_user_id
    ORDER BY fd.updated_at DESC
    LIMIT 1
    `,
    [Number(fundingId)]
  );

  return rows[0] || null;
};

const findFallbackFundingDraftByFundingId = async (fundingId) => {
  const { rows } = await pool.query(
    `
    SELECT fd.*
    FROM funding_projects fp
    JOIN funding_drafts fd
      ON fd.funding_id IS NULL
      AND NULLIF(BTRIM(fd.title), '') = NULLIF(BTRIM(fp.title), '')
      AND fd.brewery_id = fp.brewery_user_id
    WHERE fp.funding_id = $1
    ORDER BY
      CASE
        WHEN fd.status IN ('APPROVED', 'SUBMITTED', 'REVIEWING') THEN 0
        ELSE 1
      END,
      ABS(EXTRACT(EPOCH FROM (
        COALESCE(fd.submitted_at, fd.updated_at, fd.created_at)
        - fp.created_at
      ))) ASC NULLS LAST,
      fd.updated_at DESC
    LIMIT 1
    `,
    [Number(fundingId)]
  );

  return rows[0] || null;
};

const calculateFundingPeriodDays = (startDate, endDate) => {
  if (!startDate || !endDate) {
    return null;
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((end.getTime() - start.getTime()) / millisecondsPerDay);

  return diffDays > 0 ? diffDays : null;
};

const FUNDING_DRAFT_PAYLOAD_SECTIONS = [
  'basicInfo',
  'schedule',
  'legalInfo',
  'tasteProfile',
  'plan',
  'breweryInfo',
  'notices',
];

const getPayloadCandidate = (body, keys, sections = FUNDING_DRAFT_PAYLOAD_SECTIONS) => {
  for (const key of keys) {
    if (hasOwn(body, key)) {
      return { exists: true, value: body[key] };
    }
  }

  for (const section of sections) {
    const sectionValue = body?.[section];

    if (!sectionValue || typeof sectionValue !== 'object' || Array.isArray(sectionValue)) {
      continue;
    }

    for (const key of keys) {
      if (hasOwn(sectionValue, key)) {
        return { exists: true, value: sectionValue[key] };
      }
    }
  }

  return { exists: false, value: undefined };
};

const getExplicitProjectPolicyCandidate = (body) =>
  getPayloadCandidate(
    body,
    ['policy', 'projectPolicy', 'project_policy'],
    ['plan', 'notices', 'legalInfo']
  );

const normalizeDraftTextValue = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value === '' ? null : value;
};

const normalizeDraftOriginalTextValue = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return normalizeOriginalTextField(value);
};

const normalizeDraftNumberValue = (value) => toNullableNumber(value);

const normalizeDraftBooleanValue = (value) => {
  const parsed = parseOptionalBoolean(value);
  return parsed === undefined ? null : parsed;
};

const normalizeDraftJsonListValue = (value) =>
  normalizeJsonStorageValue(parseFundingListField(value), []);

const buildFundingDraftPatchFromPayload = (bodyPayload = {}, currentDraft = {}) => {
  const assignments = [];
  const values = [];
  let progressRate = 0;
  let hasTasteProfile = false;

  const addAssignment = (column, value, sectionProgress = 0) => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
    progressRate = Math.max(progressRate, sectionProgress);
  };

  const addFromPayload = (column, keys, sections, normalize, sectionProgress = 0) => {
    const candidate = getPayloadCandidate(bodyPayload, keys, sections);

    if (!candidate.exists) {
      return false;
    }

    addAssignment(column, normalize(candidate.value), sectionProgress);
    return true;
  };

  addFromPayload('title', ['title'], ['basicInfo'], normalizeDraftTextValue, 33);
  addFromPayload('short_title', ['shortTitle', 'short_title'], ['basicInfo'], normalizeDraftTextValue, 33);
  addFromPayload('category', ['category'], ['basicInfo'], normalizeDraftTextValue, 33);
  addFromPayload('main_ingredient', ['mainIngredient', 'main_ingredient'], ['basicInfo', 'legalInfo'], normalizeDraftTextValue, 33);
  addFromPayload(
    'sub_ingredients',
    ['subIngredients', 'subIngredient', 'sub_ingredients'],
    ['basicInfo', 'legalInfo'],
    normalizeDraftJsonListValue,
    33
  );
  addFromPayload(
    'alcohol_percentage',
    ['alcoholPercentage', 'alcohol_percentage', 'alcoholDegree', 'alcoholContent', 'abv'],
    ['basicInfo', 'legalInfo', 'tasteProfile'],
    normalizeDraftNumberValue,
    33
  );
  addFromPayload('summary', ['projectSummary', 'summary', 'description'], ['basicInfo'], normalizeDraftTextValue, 33);

  const imageCandidate = getPayloadCandidate(
    bodyPayload,
    ['imageUrls', 'image_urls', 'images'],
    ['basicInfo', 'images']
  );
  const thumbnailCandidate = getPayloadCandidate(
    bodyPayload,
    ['representativeImageUrl', 'representative_image_url', 'thumbnailUrl', 'thumbnail_url', 'imageUrl', 'image_url'],
    ['basicInfo', 'images']
  );

  if (imageCandidate.exists) {
    const normalizedImageUrls = normalizeFundingImageUrlsInput(imageCandidate.value).slice(0, 5);
    addAssignment('image_urls', normalizeJsonStorageValue(normalizedImageUrls, []), 33);
    addAssignment(
      'thumbnail_url',
      normalizePublicImageUrl(thumbnailCandidate.value) || normalizedImageUrls[0] || null,
      33
    );
  } else if (thumbnailCandidate.exists) {
    addAssignment('thumbnail_url', normalizePublicImageUrl(thumbnailCandidate.value), 33);
  }

  addFromPayload('tags', ['searchTags', 'search_tags', 'tags'], ['basicInfo'], normalizeDraftJsonListValue, 33);
  addFromPayload('recipe_id', ['recipeId', 'recipe_id'], ['basicInfo'], normalizeDraftNumberValue, 33);

  const priceCandidate = getPayloadCandidate(bodyPayload, ['bottleUnitPrice', 'unitPrice', 'pricePerBottle', 'price_per_bottle'], ['schedule']);
  const quantityCandidate = getPayloadCandidate(bodyPayload, ['totalSalesQuantity', 'totalQuantity', 'quantity', 'total_quantity'], ['schedule']);
  const targetCandidate = getPayloadCandidate(bodyPayload, ['targetAmount', 'target_amount', 'goalAmount', 'goal_amount'], ['schedule']);

  if (priceCandidate.exists) {
    addAssignment('price_per_bottle', normalizeDraftNumberValue(priceCandidate.value), 47);
  }

  if (quantityCandidate.exists) {
    addAssignment('total_quantity', normalizeDraftNumberValue(quantityCandidate.value), 47);
  }

  if (targetCandidate.exists) {
    addAssignment('target_amount', normalizeDraftNumberValue(targetCandidate.value), 47);
  } else if (priceCandidate.exists && quantityCandidate.exists) {
    const price = normalizeDraftNumberValue(priceCandidate.value);
    const quantity = normalizeDraftNumberValue(quantityCandidate.value);
    addAssignment('target_amount', price !== null && quantity !== null ? price * quantity : null, 47);
  }

  const startDateCandidate = getPayloadCandidate(
    bodyPayload,
    ['fundingStartDate', 'funding_start_date', 'startDate', 'start_date'],
    ['schedule']
  );
  const endDateCandidate = getPayloadCandidate(
    bodyPayload,
    ['fundingEndDate', 'funding_end_date', 'endDate', 'end_date'],
    ['schedule']
  );
  const periodCandidate = getPayloadCandidate(
    bodyPayload,
    ['projectDuration', 'fundingPeriodDays', 'funding_period_days'],
    ['schedule']
  );

  if (startDateCandidate.exists) {
    addAssignment('funding_start_date', normalizeDraftTextValue(startDateCandidate.value), 47);
  }

  if (periodCandidate.exists) {
    addAssignment('funding_period_days', normalizeDraftNumberValue(periodCandidate.value), 47);
  }

  if (endDateCandidate.exists) {
    addAssignment('funding_end_date', normalizeDraftTextValue(endDateCandidate.value), 47);
  } else if (startDateCandidate.exists && periodCandidate.exists) {
    const start = new Date(startDateCandidate.value);
    const period = Number(periodCandidate.value);

    if (!Number.isNaN(start.getTime()) && Number.isFinite(period)) {
      const end = new Date(start);
      end.setDate(end.getDate() + period);
      addAssignment('funding_end_date', end.toISOString().slice(0, 10), 47);
    }
  }

  addFromPayload(
    'expected_delivery_date',
    ['expectedDeliveryStartDate', 'expectedDeliveryDate', 'expected_delivery_date'],
    ['schedule'],
    normalizeDraftTextValue,
    47
  );
  addFromPayload('schedule_summary', ['scheduleSummary', 'schedule_summary'], ['schedule'], normalizeDraftOriginalTextValue, 47);
  addFromPayload('platform_fee_rate', ['platformFeeRate', 'platform_fee_rate'], ['schedule'], normalizeDraftNumberValue, 47);
  addFromPayload('platform_fee_amount', ['platformFeeAmount', 'platform_fee_amount'], ['schedule'], normalizeDraftNumberValue, 47);
  addFromPayload('shipping_fee', ['shippingFee', 'shipping_fee'], ['schedule'], normalizeDraftNumberValue, 47);

  addFromPayload('product_type', ['productType', 'product_type'], ['legalInfo'], normalizeDraftTextValue, 57);
  addFromPayload('volume', ['volume'], ['legalInfo'], normalizeDraftNumberValue, 57);
  addFromPayload('raw_materials', ['rawMaterials', 'raw_materials'], ['legalInfo'], normalizeRawMaterialsStorageValue, 57);

  const sweetnessCandidate = getPayloadCandidate(bodyPayload, ['sweetness'], ['tasteProfile']);
  const acidityCandidate = getPayloadCandidate(bodyPayload, ['acidity'], ['tasteProfile']);
  const bodyCandidate = getPayloadCandidate(bodyPayload, ['body'], ['tasteProfile']);
  const carbonationCandidate = getPayloadCandidate(bodyPayload, ['carbonation'], ['tasteProfile']);
  const alcoholCandidate = getPayloadCandidate(bodyPayload, ['alcoholIntensity', 'alcohol_intensity', 'alcohol'], ['tasteProfile']);

  if (sweetnessCandidate.exists) {
    addAssignment('sweetness', normalizeDraftNumberValue(sweetnessCandidate.value), 64);
    hasTasteProfile = true;
  }
  if (acidityCandidate.exists) {
    addAssignment('acidity', normalizeDraftNumberValue(acidityCandidate.value), 64);
    hasTasteProfile = true;
  }
  if (bodyCandidate.exists) {
    addAssignment('body', normalizeDraftNumberValue(bodyCandidate.value), 64);
    hasTasteProfile = true;
  }
  if (carbonationCandidate.exists) {
    addAssignment('carbonation', normalizeDraftNumberValue(carbonationCandidate.value), 64);
    hasTasteProfile = true;
  }
  if (alcoholCandidate.exists) {
    addAssignment('alcohol_intensity', normalizeDraftNumberValue(alcoholCandidate.value), 64);
    hasTasteProfile = true;
  }

  const tasteExtraKeys = [
    ['flavorNotes', 'flavor_notes'],
    ['flavorTags', 'flavor_tags'],
    ['flavor'],
    ['aromaIntensity', 'aroma_intensity'],
    ['aftertaste', 'finish', 'residualFlavor', 'residual_flavor'],
    ['tasteInput', 'taste_input'],
    ['tasteVector', 'taste_vector'],
  ];
  const hasTasteExtras = tasteExtraKeys.some((keys) =>
    getPayloadCandidate(bodyPayload, keys, ['tasteProfile']).exists
  );

  if (hasTasteExtras) {
    const currentExtras = parseTasteProfileExtras(currentDraft.flavor_notes);
    const getTasteValue = (keys, fallback) => {
      const candidate = getPayloadCandidate(bodyPayload, keys, ['tasteProfile']);
      return candidate.exists ? candidate.value : fallback;
    };

    addAssignment(
      'flavor_notes',
      buildTasteProfileStorage({
        flavorNotes: getTasteValue(['flavorNotes', 'flavor_notes'], currentExtras.flavorNotes),
        flavorTags: getTasteValue(['flavorTags', 'flavor_tags'], currentExtras.flavorTags),
        flavor: getTasteValue(['flavor'], currentExtras.flavor),
        aromaIntensity: getTasteValue(['aromaIntensity', 'aroma_intensity'], currentExtras.aromaIntensity),
        finish: getTasteValue(['aftertaste', 'finish', 'residualFlavor', 'residual_flavor'], currentExtras.finish),
        tasteInput: getTasteValue(['tasteInput', 'taste_input'], currentExtras.tasteInput),
        tasteVector: getTasteValue(['tasteVector', 'taste_vector'], currentExtras.tasteVector),
      }),
      64
    );
    hasTasteProfile = true;
  }

  addFromPayload('introduction', ['introduction', 'projectDescription', 'projectIntroduction', 'productionPlan', 'fundingPurpose'], ['plan'], normalizeDraftOriginalTextValue, 78);
  addFromPayload('video_url', ['videoUrl', 'video_url', 'projectVideoUrl', 'project_video_url'], ['plan'], normalizeDraftTextValue, 78);
  addFromPayload('budget_plan', ['budgetPlan', 'budget_plan', 'projectBudget'], ['plan'], normalizeDraftOriginalTextValue, 78);
  addFromPayload('schedule_plan', ['projectSchedule', 'schedulePlan', 'schedule_plan'], ['plan'], normalizeDraftOriginalTextValue, 78);

  const explicitProjectPolicyCandidate = getExplicitProjectPolicyCandidate(bodyPayload);
  if (explicitProjectPolicyCandidate.exists) {
    const normalizedProjectPolicy = normalizeDraftOriginalTextValue(explicitProjectPolicyCandidate.value);
    addAssignment('refund_policy', normalizedProjectPolicy, 78);
    addAssignment('exchange_policy', normalizedProjectPolicy, 78);
  } else {
    addFromPayload('refund_policy', ['refundPolicy', 'refund_policy'], ['plan', 'notices'], normalizeDraftOriginalTextValue, 78);
    addFromPayload('exchange_policy', ['exchangePolicy', 'exchange_policy'], ['plan', 'notices'], normalizeDraftOriginalTextValue, 78);
  }

  addFromPayload('brewery_name', ['breweryName', 'brewery_name'], ['breweryInfo'], normalizeDraftTextValue, 85);
  addFromPayload('creator_name', ['creatorName', 'creator_name'], ['breweryInfo'], normalizeDraftTextValue, 85);
  addFromPayload('profile_image_url', ['profileImageUrl', 'profile_image_url', 'breweryProfileImageUrl', 'brewery_profile_image_url'], ['breweryInfo'], normalizeDraftTextValue, 85);
  addFromPayload('creator_introduction', ['creatorIntroduction', 'creator_introduction', 'breweryBio', 'brewery_bio'], ['breweryInfo'], normalizeDraftOriginalTextValue, 85);
  addFromPayload('representative_name', ['representativeName', 'representative_name'], ['breweryInfo'], normalizeDraftTextValue, 85);
  addFromPayload('business_registration_number', ['businessRegistrationNumber', 'business_registration_number', 'businessNumber', 'licenseNumber'], ['breweryInfo', 'legalInfo'], normalizeDraftTextValue, 85);
  addFromPayload('business_address', ['businessAddress', 'business_address'], ['breweryInfo', 'legalInfo'], normalizeDraftTextValue, 85);
  addFromPayload('business_address_detail', ['businessAddressDetail', 'business_address_detail'], ['breweryInfo', 'legalInfo'], normalizeDraftTextValue, 85);
  addFromPayload('contact_email', ['contactEmail', 'contact_email'], ['breweryInfo'], normalizeDraftTextValue, 85);
  addFromPayload('contact_phone', ['contactPhone', 'contact_phone', 'phoneNumber', 'phone_number'], ['breweryInfo'], normalizeDraftTextValue, 85);
  addFromPayload('bank_name', ['bankName', 'bank_name'], ['breweryInfo'], normalizeDraftTextValue, 85);
  addFromPayload('account_number', ['accountNumber', 'account_number'], ['breweryInfo'], normalizeDraftTextValue, 85);
  addFromPayload('account_holder', ['accountHolder', 'account_holder'], ['breweryInfo'], normalizeDraftTextValue, 85);
  addFromPayload('business_classification', ['businessClassification', 'business_classification', 'businessType', 'business_type'], ['breweryInfo'], normalizeDraftTextValue, 85);
  addFromPayload('business_type', ['businessType', 'business_type'], ['breweryInfo'], normalizeDraftTextValue, 85);
  addFromPayload('business_name', ['companyName', 'company_name', 'businessName', 'business_name'], ['breweryInfo'], normalizeDraftTextValue, 85);
  addFromPayload('business_category', ['businessCategory', 'business_category'], ['breweryInfo'], normalizeDraftTextValue, 85);
  addFromPayload('business_item', ['businessItem', 'business_item'], ['breweryInfo'], normalizeDraftTextValue, 85);
  addFromPayload('tax_email', ['taxEmail', 'tax_email', 'email'], ['breweryInfo'], normalizeDraftTextValue, 85);
  addFromPayload('phone_verified', ['phoneVerified', 'phone_verified'], ['breweryInfo'], normalizeDraftBooleanValue, 85);
  addFromPayload('account_verified', ['accountVerified', 'account_verified'], ['breweryInfo'], normalizeDraftBooleanValue, 85);
  addFromPayload('identity_document_url', ['identityDocumentUrl', 'identity_document_url'], ['breweryInfo'], normalizeDraftTextValue, 85);
  addFromPayload('business_registration_file_url', ['businessRegistrationFileUrl', 'business_registration_file_url', 'businessLicenseUrl', 'documentUrl'], ['breweryInfo'], normalizeDraftTextValue, 85);

  addFromPayload('adult_verification_notice', ['adultVerificationNotice', 'adult_verification_notice'], ['notices'], normalizeDraftOriginalTextValue, 92);
  addFromPayload('risk_notice', ['expectedDifficulties', 'expected_difficulties', 'risks', 'riskPlan', 'risk_plan', 'riskNotice', 'risk_notice'], ['notices', 'plan'], normalizeDraftOriginalTextValue, 92);

  return {
    assignments,
    values,
    progressRate,
    hasTasteProfile,
  };
};

const updateFundingDraftRowFromPayload = async (draftId, bodyPayload = {}) => {
  const currentResult = await pool.query(
    `
    SELECT *
    FROM funding_drafts
    WHERE draft_id = $1
    `,
    [Number(draftId)]
  );

  const currentDraft = currentResult.rows[0];

  if (!currentDraft) {
    return null;
  }

  const patch = buildFundingDraftPatchFromPayload(bodyPayload, currentDraft);

  if (patch.assignments.length === 0) {
    return currentDraft;
  }

  const values = [...patch.values];
  const progressPlaceholder = `$${values.length + 1}`;
  values.push(patch.progressRate);
  const draftIdPlaceholder = `$${values.length + 1}`;
  values.push(Number(draftId));

  const { rows } = await pool.query(
    `
    UPDATE funding_drafts
    SET
      ${patch.assignments.join(',\n      ')},
      progress_rate = CASE
        WHEN ${progressPlaceholder}::int > 0 THEN GREATEST(progress_rate, ${progressPlaceholder}::int)
        ELSE progress_rate
      END,
      updated_at = CURRENT_TIMESTAMP
    WHERE draft_id = ${draftIdPlaceholder}
    RETURNING *
    `,
    values
  );

  const updatedDraft = rows[0];

  if (updatedDraft?.draft_id) {
    await syncFundingProjectFieldsFromDraft(updatedDraft.draft_id);

    if (patch.hasTasteProfile) {
      await syncTasteProfileFromDraft(updatedDraft.draft_id);
    }
  }

  return updatedDraft;
};

const normalizeManagementDraftStatus = (fundingStatus) => {
  const status = toTrimmedString(fundingStatus).toUpperCase();

  if (
    [
      'ACTIVE',
      'ONGOING',
      'COMPLETED',
      'SUCCESSFUL',
      'APPROVED',
      'CANCELED',
      'CANCELLED',
    ].includes(status)
  ) {
    return 'APPROVED';
  }

  if (['REVIEWING', 'READY', 'PENDING', 'SUBMITTED'].includes(status)) {
    return 'SUBMITTED';
  }

  return 'SUBMITTED';
};

const FUNDING_PROJECT_MANAGEMENT_COLUMNS = [
  'total_quantity',
  'budget_plan',
  'schedule_plan',
  'refund_policy',
  'exchange_policy',
  'creator_introduction',
];

let fundingProjectManagementColumnsCache = null;
let fundingProjectRawMaterialsColumnCache = null;

const getFundingProjectManagementColumns = async () => {
  if (fundingProjectManagementColumnsCache) {
    return fundingProjectManagementColumnsCache;
  }

  const { rows } = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'funding_projects'
      AND column_name = ANY($1::text[])
    `,
    [FUNDING_PROJECT_MANAGEMENT_COLUMNS]
  );

  fundingProjectManagementColumnsCache = new Set(rows.map((row) => row.column_name));
  return fundingProjectManagementColumnsCache;
};

const projectManagementColumnSelect = (columns, columnName, alias) =>
  columns.has(columnName)
    ? `fp.${columnName} AS ${alias}`
    : `NULL::text AS ${alias}`;

const BREWERY_LOG_OPTIONAL_COLUMNS = [
  'video_url',
  'updated_at',
];

let breweryLogOptionalColumnsCache = null;

const getBreweryLogOptionalColumns = async () => {
  if (breweryLogOptionalColumnsCache) {
    return breweryLogOptionalColumnsCache;
  }

  const { rows } = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'brewery_logs'
      AND column_name = ANY($1::text[])
    `,
    [BREWERY_LOG_OPTIONAL_COLUMNS]
  );

  breweryLogOptionalColumnsCache = new Set(rows.map((row) => row.column_name));
  return breweryLogOptionalColumnsCache;
};

const getFundingProjectRawMaterialsColumn = async () => {
  if (fundingProjectRawMaterialsColumnCache) {
    return fundingProjectRawMaterialsColumnCache;
  }

  const { rows } = await pool.query(
    `
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'funding_projects'
      AND column_name = 'raw_materials'
    LIMIT 1
    `
  );

  fundingProjectRawMaterialsColumnCache = rows[0] || null;
  return fundingProjectRawMaterialsColumnCache;
};

const normalizeBreweryLogVideoUrl = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed || null;
};

const hasBreweryLogVideoUrlField = (body = {}) =>
  hasOwn(body, 'videoUrl') || hasOwn(body, 'video_url') || hasOwn(body, 'url');

const getBreweryLogVideoUrlFromBody = (body = {}) =>
  normalizeBreweryLogVideoUrl(getBodyValue(body, ['videoUrl', 'video_url', 'url']));

const mapBreweryLogImageUrls = (value) => uniqueValues(parseJsonArrayField(value));

const mapBreweryLogResponse = (log, extra = {}) => ({
  breweryLogId: Number(log.log_id),
  logId: Number(log.log_id),
  fundingId: Number(log.funding_id),
  stage: log.step,
  title: log.title,
  content: log.content,
  videoUrl: log.video_url || null,
  imageUrls: mapBreweryLogImageUrls(log.image_urls),
  likeCount: Number(extra.likeCount ?? log.like_count ?? 0),
  liked: Boolean(extra.liked ?? log.liked ?? false),
  commentCount: Number(extra.commentCount ?? log.comment_count ?? 0),
  createdAt: log.created_at,
  updatedAt: log.updated_at || log.created_at,
});

const recoverFundingDraftFromProject = async (fundingId) => {
  const managementColumns = await getFundingProjectManagementColumns();
  const rawMaterialsColumn = await getFundingProjectRawMaterialsColumn();
  const projectRawMaterialsSelect = rawMaterialsColumn
    ? 'fp.raw_materials::text AS project_raw_materials'
    : 'NULL::text AS project_raw_materials';

  const { rows } = await pool.query(
    `
    SELECT
      fp.funding_id,
      fp.brewery_user_id,
      fp.recipe_id,
      fp.title,
      fp.short_title,
      fp.description,
      fp.summary,
      fp.category,
      fp.thumbnail_url,
      fp.image_urls,
      fp.goal_amount,
      fp.start_date,
      fp.end_date,
      fp.expected_delivery_date,
      fp.price_per_bottle,
      fp.shipping_fee,
      ${projectManagementColumnSelect(managementColumns, 'total_quantity', 'project_total_quantity')},
      fp.volume,
      fp.alcohol_percentage,
      fp.status,
      fp.created_at,
      r.main_ingredient AS recipe_main_ingredient,
      r.ai_sub_ingredient AS recipe_sub_ingredients,
      r.target_flavor AS recipe_target_flavor,
      r.content AS recipe_content,
      r.summary AS recipe_summary,
      u.nickname AS user_nickname,
      u.email AS user_email,
      u.phone_number AS user_phone_number,
      u.profile_image AS user_profile_image,
      ba.brewery_name AS auth_brewery_name,
      ba.location AS auth_business_address,
      ba.business_address_detail AS auth_business_address_detail,
      ba.license_number AS auth_license_number,
      ba.phone_number AS auth_phone_number,
      ba.document_url AS auth_document_url,
      tp.sweetness,
      tp.acidity,
      tp.body,
      tp.carbonation,
      tp.alcohol_intensity,
      tp.flavor_notes,
      ${projectRawMaterialsSelect},
      support_options.total_stock,
      ${projectManagementColumnSelect(managementColumns, 'budget_plan', 'project_budget_plan')},
      ${projectManagementColumnSelect(managementColumns, 'schedule_plan', 'project_schedule_plan')},
      ${projectManagementColumnSelect(managementColumns, 'refund_policy', 'project_refund_policy')},
      ${projectManagementColumnSelect(managementColumns, 'exchange_policy', 'project_exchange_policy')},
      ${projectManagementColumnSelect(managementColumns, 'creator_introduction', 'project_creator_introduction')}
    FROM funding_projects fp
    LEFT JOIN recipes r ON r.recipe_id = fp.recipe_id
    LEFT JOIN users u ON u.user_id = fp.brewery_user_id
    LEFT JOIN LATERAL (
      SELECT
        brewery_name,
        location,
        business_address_detail,
        license_number,
        phone_number,
        document_url
      FROM brewery_auth
      WHERE user_id = fp.brewery_user_id
      ORDER BY
        CASE WHEN status = 'APPROVED' THEN 0 ELSE 1 END,
        updated_at DESC,
        application_id DESC
      LIMIT 1
    ) ba ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        sweetness,
        acidity,
        body,
        carbonation,
        alcohol_intensity,
        flavor_notes
      FROM taste_profiles
      WHERE funding_id = fp.funding_id
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    ) tp ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(stock), 0)::int AS total_stock
      FROM funding_support_options
      WHERE funding_id = fp.funding_id
    ) support_options ON TRUE
    WHERE fp.funding_id = $1
    `,
    [Number(fundingId)]
  );

  const funding = rows[0];

  if (!funding) {
    return null;
  }

  const subIngredients = parseFundingListField(funding.recipe_sub_ingredients);
  const totalStock = Number(funding.total_stock || 0);
  const projectTotalQuantity = toNullableNumber(funding.project_total_quantity);
  const pricePerBottle = toNullableNumber(funding.price_per_bottle);
  const goalAmount = toNullableNumber(funding.goal_amount);
  const estimatedTotalQuantity =
    projectTotalQuantity !== null && projectTotalQuantity !== undefined
      ? projectTotalQuantity
      : totalStock > 0
      ? totalStock
      : pricePerBottle && goalAmount
        ? Math.floor(goalAmount / pricePerBottle)
        : null;

  const result = await pool.query(
    `
    INSERT INTO funding_drafts (
      brewery_id,
      recipe_id,
      funding_id,
      status,
      progress_rate,
      title,
      short_title,
      category,
      main_ingredient,
      sub_ingredients,
      alcohol_percentage,
      summary,
      thumbnail_url,
      image_urls,
      price_per_bottle,
      total_quantity,
      target_amount,
      funding_start_date,
      funding_period_days,
      funding_end_date,
      expected_delivery_date,
      shipping_fee,
      volume,
      sweetness,
      acidity,
      body,
      carbonation,
      alcohol_intensity,
      flavor_notes,
      introduction,
      budget_plan,
      schedule_plan,
      refund_policy,
      exchange_policy,
      brewery_name,
      creator_name,
      profile_image_url,
      creator_introduction,
      business_registration_number,
      business_address,
      business_address_detail,
      contact_email,
      contact_phone,
      business_registration_file_url,
      submitted_at,
      created_at,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, 100,
      $5, $6, $7, $8, $9, $10, $11, $12, $13,
      $14, $15, $16, $17, $18, $19, $20, $21, $22,
      $23, $24, $25, $26, $27, $28,
      $29, $30, $31, $32, $33,
      $34, $35, $36, $37, $38, $39, $40, $41, $42, $43,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    RETURNING *
    `,
    [
      Number(funding.brewery_user_id),
      funding.recipe_id === null || funding.recipe_id === undefined
        ? null
        : Number(funding.recipe_id),
      Number(funding.funding_id),
      normalizeManagementDraftStatus(funding.status),
      funding.title || null,
      funding.short_title || null,
      funding.category || null,
      funding.recipe_main_ingredient || null,
      normalizeJsonStorageValue(subIngredients, []),
      funding.alcohol_percentage === null || funding.alcohol_percentage === undefined
        ? null
        : Number(funding.alcohol_percentage),
      funding.summary || funding.description || funding.recipe_summary || null,
      funding.thumbnail_url || null,
      normalizeJsonStorageValue(funding.image_urls, []),
      pricePerBottle,
      estimatedTotalQuantity,
      goalAmount,
      funding.start_date || null,
      calculateFundingPeriodDays(funding.start_date, funding.end_date),
      funding.end_date || null,
      funding.expected_delivery_date || null,
      toNullableNumber(funding.shipping_fee),
      toNullableNumber(funding.volume),
      toNullableNumber(funding.sweetness),
      toNullableNumber(funding.acidity),
      toNullableNumber(funding.body),
      toNullableNumber(funding.carbonation),
      toNullableNumber(funding.alcohol_intensity),
      normalizeJsonStorageValue(funding.flavor_notes || funding.recipe_target_flavor, []),
      funding.description || funding.recipe_content || funding.summary || null,
      funding.project_budget_plan || null,
      funding.project_schedule_plan || null,
      funding.project_refund_policy || null,
      funding.project_exchange_policy || null,
      funding.auth_brewery_name || funding.user_nickname || null,
      funding.user_nickname || null,
      funding.user_profile_image || null,
      funding.project_creator_introduction || null,
      funding.auth_license_number || null,
      funding.auth_business_address || null,
      funding.auth_business_address_detail || null,
      funding.user_email || null,
      funding.auth_phone_number || funding.user_phone_number || null,
      funding.auth_document_url || null,
    ]
  );

  const recoveredDraft = result.rows[0] || null;
  const recoveredRawMaterials = parseFundingRawMaterialsField(funding.project_raw_materials);

  if (recoveredDraft && recoveredRawMaterials.length > 0) {
    const updated = await pool.query(
      `
      UPDATE funding_drafts
      SET
        raw_materials = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE draft_id = $2
      RETURNING *
      `,
      [JSON.stringify(recoveredRawMaterials), Number(recoveredDraft.draft_id)]
    );

    return updated.rows[0] || recoveredDraft;
  }

  return recoveredDraft;
};

const hydrateFundingDraftManagementFieldsFromProject = async (draft) => {
  if (!draft?.draft_id || !draft?.funding_id) {
    return draft;
  }

  const managementColumns = await getFundingProjectManagementColumns();
  const assignments = [];

  FUNDING_PROJECT_MANAGEMENT_COLUMNS.forEach((columnName) => {
    if (managementColumns.has(columnName)) {
      assignments.push(`${columnName} = COALESCE(fd.${columnName}, fp.${columnName})`);
    }
  });

  if (assignments.length === 0) {
    return draft;
  }

  const { rows } = await pool.query(
    `
    UPDATE funding_drafts fd
    SET
      ${assignments.join(',\n      ')},
      updated_at = CASE
        WHEN ${assignments
          .map((assignment) => {
            const columnName = assignment.split(' = ')[0];
            return `fd.${columnName} IS NULL AND fp.${columnName} IS NOT NULL`;
          })
          .join(' OR ')}
          THEN CURRENT_TIMESTAMP
        ELSE fd.updated_at
      END
    FROM funding_projects fp
    WHERE fd.draft_id = $1
      AND fd.funding_id = fp.funding_id
    RETURNING fd.*
    `,
    [Number(draft.draft_id)]
  );

  return rows[0] || draft;
};

const mergeFundingDraftManagementFieldsFromSource = async (targetDraftId, sourceDraftId) => {
  if (!targetDraftId || !sourceDraftId || Number(targetDraftId) === Number(sourceDraftId)) {
    return null;
  }

  const { rows } = await pool.query(
    `
    UPDATE funding_drafts target
    SET
      budget_plan = COALESCE(target.budget_plan, source.budget_plan),
      schedule_plan = COALESCE(target.schedule_plan, source.schedule_plan),
      refund_policy = COALESCE(target.refund_policy, source.refund_policy),
      exchange_policy = COALESCE(target.exchange_policy, source.exchange_policy),
      creator_introduction = COALESCE(target.creator_introduction, source.creator_introduction),
      adult_verification_notice = COALESCE(target.adult_verification_notice, source.adult_verification_notice),
      risk_notice = COALESCE(target.risk_notice, source.risk_notice),
      updated_at = CASE
        WHEN
          (target.budget_plan IS NULL AND source.budget_plan IS NOT NULL) OR
          (target.schedule_plan IS NULL AND source.schedule_plan IS NOT NULL) OR
          (target.refund_policy IS NULL AND source.refund_policy IS NOT NULL) OR
          (target.exchange_policy IS NULL AND source.exchange_policy IS NOT NULL) OR
          (target.creator_introduction IS NULL AND source.creator_introduction IS NOT NULL) OR
          (target.adult_verification_notice IS NULL AND source.adult_verification_notice IS NOT NULL) OR
          (target.risk_notice IS NULL AND source.risk_notice IS NOT NULL)
          THEN CURRENT_TIMESTAMP
        ELSE target.updated_at
      END
    FROM funding_drafts source
    WHERE target.draft_id = $1
      AND source.draft_id = $2
      AND target.brewery_id = source.brewery_id
    RETURNING target.*
    `,
    [Number(targetDraftId), Number(sourceDraftId)]
  );

  return rows[0] || null;
};

const findAndLinkFundingDraftByFundingId = async (fundingId) => {
  const directDraft = await findDirectFundingDraftByFundingId(fundingId);

  if (directDraft) {
    return hydrateFundingDraftManagementFieldsFromProject(directDraft);
  }

  return recoverFundingDraftFromProject(fundingId);
};

const syncFundingProjectFieldsFromDraft = async (draftId) => {
  const { rows } = await pool.query(
    `
    SELECT funding_id, image_urls, raw_materials
    FROM funding_drafts
    WHERE draft_id = $1
      AND funding_id IS NOT NULL
    `,
    [Number(draftId)]
  );

  const draft = rows[0];

  if (!draft) {
    return;
  }

  await pool.query(
    `
    UPDATE funding_projects fp
    SET
      title = COALESCE(fd.title, fp.title),
      short_title = COALESCE(fd.short_title, fp.short_title),
      description = COALESCE(fd.summary, fd.introduction, fp.description),
      summary = COALESCE(fd.summary, fp.summary),
      category = COALESCE(fd.category, fp.category),
      thumbnail_url = COALESCE(fd.thumbnail_url, fp.thumbnail_url),
      goal_amount = COALESCE(fd.target_amount, fp.goal_amount),
      start_date = COALESCE(fd.funding_start_date, fp.start_date),
      end_date = COALESCE(fd.funding_end_date, fp.end_date),
      expected_delivery_date = COALESCE(fd.expected_delivery_date, fp.expected_delivery_date),
      price_per_bottle = COALESCE(fd.price_per_bottle, fp.price_per_bottle),
      shipping_fee = COALESCE(fd.shipping_fee, fp.shipping_fee),
      volume = COALESCE(fd.volume, fp.volume),
      alcohol_percentage = COALESCE(fd.alcohol_percentage, fp.alcohol_percentage),
      updated_at = CURRENT_TIMESTAMP
    FROM funding_drafts fd
    WHERE fd.draft_id = $1
      AND fd.funding_id = fp.funding_id
    `,
    [Number(draftId)]
  );

  if (draft.image_urls !== undefined && draft.image_urls !== null) {
    await pool.query(
      `
      UPDATE funding_projects
      SET
        image_urls = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE funding_id = $2
      `,
      [
        normalizeJsonStorageValue(normalizeFundingImageUrlsInput(draft.image_urls).slice(0, 5), []),
        Number(draft.funding_id),
      ]
    );
  }

  const rawMaterialsColumn = await getFundingProjectRawMaterialsColumn();
  const normalizedRawMaterials = parseFundingRawMaterialsField(draft.raw_materials);

  if (rawMaterialsColumn && normalizedRawMaterials.length > 0) {
    const rawMaterialsAssignment = ['json', 'jsonb'].includes(rawMaterialsColumn.data_type)
      ? '$1::jsonb'
      : '$1';

    await pool.query(
      `
      UPDATE funding_projects
      SET
        raw_materials = ${rawMaterialsAssignment},
        updated_at = CURRENT_TIMESTAMP
      WHERE funding_id = $2
      `,
      [
        JSON.stringify(normalizedRawMaterials),
        Number(draft.funding_id),
      ]
    );
  }

  const managementColumns = await getFundingProjectManagementColumns();
  const managementAssignments = [];

  FUNDING_PROJECT_MANAGEMENT_COLUMNS.forEach((columnName) => {
    if (managementColumns.has(columnName)) {
      managementAssignments.push(`${columnName} = COALESCE(fd.${columnName}, fp.${columnName})`);
    }
  });

  if (managementAssignments.length > 0) {
    await pool.query(
      `
      UPDATE funding_projects fp
      SET
        ${managementAssignments.join(',\n        ')},
        updated_at = CURRENT_TIMESTAMP
      FROM funding_drafts fd
      WHERE fd.draft_id = $1
        AND fd.funding_id = fp.funding_id
      `,
      [Number(draftId)]
    );
  }
};

const syncTasteProfileFromDraft = async (draftId) => {
  const updateResult = await pool.query(
    `
    WITH latest_profile AS (
      SELECT tp.taste_profile_id
      FROM taste_profiles tp
      JOIN funding_drafts fd ON fd.funding_id = tp.funding_id
      WHERE fd.draft_id = $1
      ORDER BY tp.updated_at DESC, tp.created_at DESC
      LIMIT 1
    )
    UPDATE taste_profiles tp
    SET
      sweetness = fd.sweetness,
      acidity = fd.acidity,
      body = fd.body,
      carbonation = fd.carbonation,
      alcohol_intensity = fd.alcohol_intensity,
      flavor_notes = fd.flavor_notes,
      updated_at = CURRENT_TIMESTAMP
    FROM funding_drafts fd, latest_profile lp
    WHERE fd.draft_id = $1
      AND tp.taste_profile_id = lp.taste_profile_id
    RETURNING tp.taste_profile_id
    `,
    [Number(draftId)]
  );

  if (updateResult.rows.length > 0) {
    return;
  }

  await pool.query(
    `
    INSERT INTO taste_profiles (
      funding_id,
      user_id,
      sweetness,
      acidity,
      body,
      carbonation,
      alcohol_intensity,
      flavor_notes,
      created_at,
      updated_at
    )
    SELECT
      funding_id,
      brewery_id,
      sweetness,
      acidity,
      body,
      carbonation,
      alcohol_intensity,
      flavor_notes,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    FROM funding_drafts
    WHERE draft_id = $1
      AND funding_id IS NOT NULL
    `,
    [Number(draftId)]
  );
};

const storeUploadedFile = async (file, folder, ownerId = 'anonymous') => {
  if (!file) {
    return null;
  }

  const strictS3 = process.env.FILE_UPLOAD_STRICT_S3 === 'true';

  if (process.env.AWS_S3_BUCKET && process.env.AWS_REGION) {
    try {
      return await uploadFileToS3(file.buffer, file.originalname, file.mimetype, ownerId);
    } catch (error) {
      if (strictS3) {
        throw error;
      }
    }
  }

  if (strictS3) {
    throw new Error('S3 업로드 설정이 필요합니다.');
  }

  const base64 = file.buffer.toString('base64');
  return `data:${file.mimetype};base64,${base64}`;
};

const DOCUMENT_TYPE_ALIASES = {
  idCard: 'ID_CARD',
  id_card: 'ID_CARD',
  ID_CARD: 'ID_CARD',
  businessLicense: 'BUSINESS_LICENSE',
  business_license: 'BUSINESS_LICENSE',
  BUSINESS_LICENSE: 'BUSINESS_LICENSE',
  BUSINESS_REGISTRATION: 'BUSINESS_LICENSE',
  salesPermit: 'SALES_PERMIT',
  sales_permit: 'SALES_PERMIT',
  SALES_PERMIT: 'SALES_PERMIT',
  MAIL_ORDER_BUSINESS: 'SALES_PERMIT',
  LIQUOR_SALES_APPROVAL: 'SALES_PERMIT',
  alcoholPermit: 'ALCOHOL_PERMIT',
  alcohol_permit: 'ALCOHOL_PERMIT',
  ALCOHOL_PERMIT: 'ALCOHOL_PERMIT',
  manufacturingLicense: 'MANUFACTURING_LICENSE',
  manufacturing_license: 'MANUFACTURING_LICENSE',
  MANUFACTURING_LICENSE: 'MANUFACTURING_LICENSE',
  LIQUOR_LICENSE: 'MANUFACTURING_LICENSE',
  BANK_ACCOUNT_COPY: 'BANK_ACCOUNT_COPY',
  ETC: 'ETC',
};

const REQUIRED_FUNDING_DOCUMENT_TYPES = [
  'ID_CARD',
  'BUSINESS_LICENSE',
  'SALES_PERMIT',
  'ALCOHOL_PERMIT',
  'MANUFACTURING_LICENSE',
];

const normalizeFundingDocumentType = (documentType) =>
  DOCUMENT_TYPE_ALIASES[documentType] || null;

const getFundingDocumentOcrErrorMessage = (result) => {
  if (!result || typeof result !== 'object') {
    return 'OCR 처리에 실패했습니다.';
  }

  return result.error || result.message || result.detail || 'OCR 처리에 실패했습니다.';
};

const getFundingDocumentOcrSources = (result) => {
  const sources = [];
  const pushObject = (value) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && !sources.includes(value)) {
      sources.push(value);
    }
  };

  pushObject(result);
  pushObject(result?.data);
  pushObject(result?.result);
  pushObject(result?.ocrResult);
  pushObject(result?.ocr_result);
  pushObject(result?.extracted);
  pushObject(result?.extractedFields);
  pushObject(result?.extracted_fields);
  pushObject(result?.fields);
  pushObject(result?.businessLicense);
  pushObject(result?.business_license);
  pushObject(result?.data?.result);
  pushObject(result?.data?.ocrResult);
  pushObject(result?.data?.ocr_result);
  pushObject(result?.data?.extracted);
  pushObject(result?.data?.extractedFields);
  pushObject(result?.data?.extracted_fields);
  pushObject(result?.data?.fields);
  pushObject(result?.data?.businessLicense);
  pushObject(result?.data?.business_license);

  return sources;
};

const getFundingDocumentOcrValue = (result, keys) => {
  const sources = getFundingDocumentOcrSources(result);

  for (const source of sources) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const value = source[key];

        if (value !== undefined && value !== null && value !== '') {
          return value;
        }
      }
    }
  }

  return null;
};

const getFundingDocumentOcrTextValue = (result, keys) => {
  const value = getFundingDocumentOcrValue(result, keys);

  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
};

const normalizeFundingDocumentOcrConfidence = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : String(value).trim() || null;
};

const normalizeFundingDocumentOcrFields = (result) => ({
  businessName: getFundingDocumentOcrTextValue(result, [
    'businessName',
    'business_name',
    'companyName',
    'company_name',
    'storeName',
    'businessPlaceName',
    '상호명',
    '상호',
    '법인명',
  ]),
  representativeName: getFundingDocumentOcrTextValue(result, [
    'representativeName',
    'representative_name',
    'ownerName',
    'owner_name',
    'representative',
    '대표자명',
    '대표자',
    '성명',
  ]),
  businessRegistrationNumber: getFundingDocumentOcrTextValue(result, [
    'businessRegistrationNumber',
    'business_registration_number',
    'licenseNumber',
    'license_number',
    'registrationNumber',
    'registration_number',
    'businessNumber',
    'business_number',
    '사업자등록번호',
    '등록번호',
  ]),
  businessAddress: getFundingDocumentOcrTextValue(result, [
    'businessAddress',
    'business_address',
    'address',
    'businessPlaceAddress',
    'business_place_address',
    '사업장주소',
    '사업장 소재지',
    '소재지',
    '주소',
  ]),
  businessType: getFundingDocumentOcrTextValue(result, [
    'businessType',
    'business_type',
    'businessCategory',
    'business_category',
    '업태',
  ]),
  businessItem: getFundingDocumentOcrTextValue(result, [
    'businessItem',
    'business_item',
    'item',
    'businessSector',
    'business_sector',
    '종목',
  ]),
  openingDate: getFundingDocumentOcrTextValue(result, [
    'openingDate',
    'opening_date',
    'startDate',
    'start_date',
    '개업일',
    '개업연월일',
  ]),
  confidence: normalizeFundingDocumentOcrConfidence(getFundingDocumentOcrValue(result, [
    'confidence',
    'score',
    'ocrConfidence',
    'ocr_confidence',
  ])),
});

const buildFundingDocumentOcrSummary = (fields) => {
  const summaryParts = [
    fields.businessName ? `상호명 ${fields.businessName}` : null,
    fields.representativeName ? `대표자 ${fields.representativeName}` : null,
    fields.businessRegistrationNumber ? `사업자등록번호 ${fields.businessRegistrationNumber}` : null,
    fields.businessAddress ? `사업장주소 ${fields.businessAddress}` : null,
    fields.businessType ? `업태 ${fields.businessType}` : null,
    fields.businessItem ? `종목 ${fields.businessItem}` : null,
  ].filter(Boolean);

  if (summaryParts.length === 0) {
    return 'OCR 처리는 완료되었지만 주요 사업자 정보를 충분히 추출하지 못했습니다.';
  }

  return `사업자등록증에서 ${summaryParts.join(', ')}이 추출되었습니다.`;
};

const buildFundingDocumentOcrResponse = (document) => {
  if (!document?.ocr_status) {
    return null;
  }

  return {
    status: document.ocr_status,
    summary: document.ocr_summary || null,
    extractedFields: parseJsonField(document.ocr_extracted_fields, null),
    result: parseJsonField(document.ocr_result, null),
    processedAt: document.ocr_processed_at || null,
    ...(document.ocr_status === 'FAILED' ? {
      message: document.ocr_summary || 'OCR 처리에 실패했습니다.',
    } : {}),
  };
};

const runFundingDocumentOcr = async ({ file, documentUrl }) => {
  const failedResult = (message = 'OCR 처리에 실패했습니다.', result = null) => ({
    status: 'FAILED',
    result: result || {
      status: 'FAILED',
      message,
    },
    summary: 'OCR 처리에 실패했습니다.',
    extractedFields: null,
  });

  if (!file?.buffer) {
    return failedResult();
  }

  try {
    const result = await requestBreweryLicenseOcr({
      file,
      documentUrl,
    });
    const ocrStatus = typeof result?.status === 'string'
      ? result.status.trim().toUpperCase()
      : '';

    if (ocrStatus === 'COMPLETED') {
      const extractedFields = normalizeFundingDocumentOcrFields(result);

      return {
        status: 'COMPLETED',
        result,
        summary: buildFundingDocumentOcrSummary(extractedFields),
        extractedFields,
      };
    }

    if (ocrStatus === 'FAILED') {
      const message = getFundingDocumentOcrErrorMessage(result);
      console.warn('Funding document OCR returned failed status', {
        documentUrl,
        fileName: file.originalname,
        message,
      });

      return failedResult(message, result);
    }

    console.warn('Funding document OCR returned unexpected status', {
      documentUrl,
      fileName: file.originalname,
      status: ocrStatus || 'MISSING',
    });

    return failedResult('OCR 처리에 실패했습니다.', result);
  } catch (error) {
    console.warn('Funding document OCR failed', {
      documentUrl,
      fileName: file.originalname,
      message: error.message,
    });

    return failedResult(error.message);
  }
};

const saveFundingDocumentOcrResult = async (documentId, ocrReview) => {
  const { rows } = await pool.query(
    `
    UPDATE funding_documents
    SET
      ocr_status = $2,
      ocr_result = $3,
      ocr_summary = $4,
      ocr_extracted_fields = $5,
      ocr_processed_at = CURRENT_TIMESTAMP
    WHERE document_id = $1
    RETURNING
      document_id,
      draft_id,
      document_type,
      file_name,
      file_url,
      mime_type,
      file_size,
      ocr_status,
      ocr_result,
      ocr_summary,
      ocr_extracted_fields,
      ocr_processed_at,
      created_at
    `,
    [
      Number(documentId),
      ocrReview.status,
      normalizeJsonStorageValue(ocrReview.result, null),
      ocrReview.summary,
      ocrReview.extractedFields
        ? normalizeJsonStorageValue(ocrReview.extractedFields, null)
        : null,
    ]
  );

  return rows[0] || null;
};

// 펀딩 처리 로직
const saveAgreement = async (req, res) => {
  const body = req.body || {};
  const breweryId = getBodyValue(body, ['breweryId', 'brewery_id']);
  const isAdultConfirmed = toRequiredBoolean(
    getBodyValue(body, ['isAdultConfirmed', 'is_adult_confirmed', 'age'])
  );
  const isContactInfoAgreed = toRequiredBoolean(
    getBodyValue(body, ['isContactInfoAgreed', 'is_contact_info_agreed', 'contact'])
  );
  const isSettlementInfoAgreed = toRequiredBoolean(
    getBodyValue(body, ['isSettlementInfoAgreed', 'is_settlement_info_agreed', 'settlement'])
  );
  const isFeePolicyAgreed = toRequiredBoolean(
    getBodyValue(body, ['isFeePolicyAgreed', 'is_fee_policy_agreed', 'fee'])
  );
  const isResponsibilityAgreed = toRequiredBoolean(
    getBodyValue(body, ['isResponsibilityAgreed', 'is_responsibility_agreed', 'responsibility'])
  );
  const isLicenseAgreed = toRequiredBoolean(
    getBodyValue(body, ['isLicenseAgreed', 'is_license_agreed', 'license'])
  );
  const isIpPolicyAgreed = toRequiredBoolean(
    getBodyValue(body, ['isIpPolicyAgreed', 'is_ip_policy_agreed', 'ip'])
  );
  const allSevenTermsAgreed =
    isAdultConfirmed &&
    isContactInfoAgreed &&
    isSettlementInfoAgreed &&
    isFeePolicyAgreed &&
    isResponsibilityAgreed &&
    isLicenseAgreed &&
    isIpPolicyAgreed;
  const allRequiredTermsAgreedValue = getBodyValue(body, [
    'allRequiredTermsAgreed',
    'all_required_terms_agreed',
  ]);
  const allRequiredTermsAgreed =
    allRequiredTermsAgreedValue === undefined
      ? allSevenTermsAgreed
      : toRequiredBoolean(allRequiredTermsAgreedValue);

  if (
    !breweryId ||
    !allSevenTermsAgreed ||
    !allRequiredTermsAgreed
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (!authorizeBreweryUserId(breweryId, req.user, res)) return;

  try {
    const result = await pool.query(
      `
      INSERT INTO funding_drafts (
        brewery_id,
        is_adult_confirmed,
        is_contact_info_agreed,
        is_settlement_info_agreed,
        is_fee_policy_agreed,
        is_responsibility_agreed,
        is_license_agreed,
        is_ip_policy_agreed,
        all_required_terms_agreed,
        status,
        progress_rate
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'DRAFT', 0)
      RETURNING draft_id, brewery_id
      `,
      [
        Number(breweryId),
        isAdultConfirmed,
        isContactInfoAgreed,
        isSettlementInfoAgreed,
        isFeePolicyAgreed,
        isResponsibilityAgreed,
        isLicenseAgreed,
        isIpPolicyAgreed,
        allRequiredTermsAgreed,
      ]
    );

    const agreement = result.rows[0];

    return res.status(200).json({
      agreementId: agreement.draft_id,
      draftId: agreement.draft_id,
      breweryId: agreement.brewery_id,
      agreements: {
        isAdultConfirmed,
        isContactInfoAgreed,
        isSettlementInfoAgreed,
        isFeePolicyAgreed,
        isResponsibilityAgreed,
        isLicenseAgreed,
        isIpPolicyAgreed,
        allRequiredTermsAgreed,
      },
      message: '펀딩 약관 동의 저장 성공',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '펀딩 약관 동의 저장 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 처리 로직
const createFundingDraft = async (req, res) => {
  const bodyPayload = req.body || {};
  const currentUserId = getAuthUserId(req.user);
  const requestedFundingId = getRequestedFundingIdFromRequest(req);
  const requestedBreweryId = getBodyValue(bodyPayload, ['breweryId', 'brewery_id']);
  let breweryId = requestedBreweryId === undefined || requestedBreweryId === null || requestedBreweryId === ''
    ? currentUserId
    : Number(requestedBreweryId);
  const {
    title,
    shortTitle,
    category,
    mainIngredient,
    subIngredients,
    subIngredient,
    alcoholPercentage,
    summary,
    thumbnailUrl,
    imageUrls,
    tags,
  } = bodyPayload;

  if (!breweryId && requestedFundingId === null) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

    if (imageUrls && !Array.isArray(imageUrls) && typeof imageUrls !== 'string') {
      return res.status(400).json({
        status: 400,
        message: '요청 값이 올바르지 않습니다.',
      });
    }

    if (imageUrls && normalizeFundingImageUrlsInput(imageUrls).length > 5) {
      return res.status(400).json({
        status: 400,
        message: '요청 값이 올바르지 않습니다.',
      });
    }

    if (tags && !Array.isArray(tags) && typeof tags !== 'string') {
      return res.status(400).json({
        status: 400,
        message: '요청 값이 올바르지 않습니다.',
      });
    }

    const normalizedImageUrls = normalizeFundingImageUrlsInput(imageUrls || []);
    const normalizedThumbnailUrl =
      normalizedImageUrls.length > 0 ? normalizedImageUrls[0] : thumbnailUrl || null;

  const progressFields = [
    title,
    shortTitle,
    category,
    mainIngredient,
    subIngredients || subIngredient,
    alcoholPercentage,
    summary,
  ];

  const filledCount = progressFields.filter(
    (field) => field !== undefined && field !== null && field !== ''
  ).length;

  const progressRate = Math.round((filledCount / progressFields.length) * 30);

  try {
    let linkedFunding = null;

    if (requestedFundingId !== null) {
      linkedFunding = await assertFundingProjectOwner(requestedFundingId, req.user);
      breweryId = Number(linkedFunding.brewery_user_id);

      const existingLinkedDraft = await findDirectFundingDraftByFundingId(requestedFundingId);

      if (existingLinkedDraft) {
        const updatedDraft = await updateFundingDraftRowFromPayload(existingLinkedDraft.draft_id, bodyPayload);
        const documents = await getFundingDraftDocuments(updatedDraft.draft_id);
        const payload = buildFundingDraftPayload(updatedDraft, documents);

        return res.status(200).json({
          ...payload,
          status: 200,
          draftStatus: payload.status,
          draft: updatedDraft,
          data: {
            ...payload,
            draft: updatedDraft,
          },
          message: '요청 처리 중 오류가 발생했습니다.',
        });
      }
    } else if (!authorizeBreweryUserId(breweryId, req.user, res)) {
      return;
    }

    const draftStatus = linkedFunding
      ? normalizeManagementDraftStatus(linkedFunding.status)
      : 'DRAFT';
    const result = await pool.query(
      `
      INSERT INTO funding_drafts (
        brewery_id,
        funding_id,
        title,
        short_title,
        category,
        main_ingredient,
        sub_ingredients,
        alcohol_percentage,
        summary,
        thumbnail_url,
        image_urls,
        tags,
        status,
        progress_rate
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING draft_id, brewery_id, funding_id, thumbnail_url, image_urls, tags, status, progress_rate, created_at
      `,
      [
        Number(breweryId),
        requestedFundingId,
        title || null,
        shortTitle || null,
        category || null,
        mainIngredient || null,
        subIngredients
          ? JSON.stringify(subIngredients)
          : subIngredient || null,
        alcoholPercentage !== undefined && alcoholPercentage !== null
          ? Number(alcoholPercentage)
          : null,
        summary || null,
        normalizedThumbnailUrl,
        JSON.stringify(normalizedImageUrls),
        JSON.stringify(tags || []),
        draftStatus,
        progressRate,
      ]
    );

    const draft = await updateFundingDraftRowFromPayload(result.rows[0].draft_id, bodyPayload);
    const documents = await getFundingDraftDocuments(draft.draft_id);
    const payload = buildFundingDraftPayload(draft, documents);

    return res.status(201).json({
      ...payload,
      draft,
      message: '펀딩 임시저장 처리가 완료되었습니다.',
    });
  } catch (error) {
    console.error(error);

    if (handleAuthorizationError(res, error)) {
      return;
    }

    return res.status(500).json({
      status: 500,
      message: '펀딩 임시저장 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 임시저장 처리 로직
const updateFundingDraft = async (req, res) => {
  const { draftId } = req.params;
  const bodyPayload = req.body || {};

  const title = getBodyValue(bodyPayload, ['title']);
  const shortTitle = getBodyValue(bodyPayload, ['shortTitle', 'short_title']);
  const category = getBodyValue(bodyPayload, ['category']);
  const mainIngredient = getBodyValue(bodyPayload, ['mainIngredient', 'main_ingredient']);
  const subIngredients = getBodyValue(bodyPayload, [
    'subIngredients',
    'subIngredient',
    'sub_ingredients',
  ]);
  const alcoholPercentage = getBodyValue(bodyPayload, [
    'alcoholPercentage',
    'alcohol_percentage',
    'abv',
  ]);
  const summary = getBodyValue(bodyPayload, ['summary', 'description']);
  const thumbnailUrl = getBodyValue(bodyPayload, ['thumbnailUrl', 'thumbnail_url', 'imageUrl']);
  const imageUrls = getBodyValue(bodyPayload, ['imageUrls', 'image_urls']);
  const tags = getBodyValue(bodyPayload, ['tags']);
  const budgetPlan = getBodyValue(bodyPayload, ['budgetPlan', 'budget_plan', 'projectBudget']);
  const schedulePlan = getBodyValue(bodyPayload, [
    'schedulePlan',
    'schedule_plan',
    'projectSchedule',
  ]);
  const policy = getBodyValue(bodyPayload, ['policy', 'projectPolicy']);

  const hasTitle = hasOwn(bodyPayload, 'title');
  const hasShortTitle = hasOwn(bodyPayload, 'shortTitle') || hasOwn(bodyPayload, 'short_title');
  const hasCategory = hasOwn(bodyPayload, 'category');
  const hasMainIngredient =
    hasOwn(bodyPayload, 'mainIngredient') || hasOwn(bodyPayload, 'main_ingredient');
  const hasSubIngredients =
    hasOwn(bodyPayload, 'subIngredients') ||
    hasOwn(bodyPayload, 'subIngredient') ||
    hasOwn(bodyPayload, 'sub_ingredients');
  const hasAlcoholPercentage =
    hasOwn(bodyPayload, 'alcoholPercentage') ||
    hasOwn(bodyPayload, 'alcohol_percentage') ||
    hasOwn(bodyPayload, 'abv');
  const hasSummary = hasOwn(bodyPayload, 'summary') || hasOwn(bodyPayload, 'description');
  const hasImageUrls = hasOwn(bodyPayload, 'imageUrls') || hasOwn(bodyPayload, 'image_urls');
  const hasThumbnailUrl =
    hasOwn(bodyPayload, 'thumbnailUrl') ||
    hasOwn(bodyPayload, 'thumbnail_url') ||
    hasOwn(bodyPayload, 'imageUrl') ||
    hasImageUrls;
  const hasTags = hasOwn(bodyPayload, 'tags');
  const hasBudgetPlan =
    hasOwn(bodyPayload, 'budgetPlan') ||
    hasOwn(bodyPayload, 'budget_plan') ||
    hasOwn(bodyPayload, 'projectBudget');
  const hasSchedulePlan =
    hasOwn(bodyPayload, 'schedulePlan') ||
    hasOwn(bodyPayload, 'schedule_plan') ||
    hasOwn(bodyPayload, 'projectSchedule');
  const hasPolicy = hasOwn(bodyPayload, 'policy') || hasOwn(bodyPayload, 'projectPolicy');

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const normalizedSubIngredients = hasSubIngredients
    ? parseFundingListField(subIngredients)
    : undefined;
  const normalizedImageUrls = hasImageUrls
    ? normalizeFundingImageUrlsInput(imageUrls)
    : undefined;
  const normalizedTags = hasTags
    ? parseFundingListField(tags)
    : undefined;

  if (hasImageUrls && normalizedImageUrls.length > 5) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const nextThumbnailUrl = hasImageUrls && !thumbnailUrl
    ? normalizedImageUrls[0] || null
    : thumbnailUrl;

  const progressFields = [
    title,
    shortTitle,
    category,
    mainIngredient,
    normalizedSubIngredients,
    alcoholPercentage,
    summary,
  ];

  const filledCount = progressFields.filter(
    (field) => field !== undefined && field !== null && field !== ''
  ).length;

  const progressRate = Math.round((filledCount / progressFields.length) * 33);

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res, getRequestedFundingIdFromRequest(req)))) return;

    const updatedDraft = await updateFundingDraftRowFromPayload(draftId, bodyPayload);

    if (!updatedDraft) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 임시저장을 찾을 수 없습니다.',
      });
    }

    const documents = await getFundingDraftDocuments(updatedDraft.draft_id);
    const payload = buildFundingDraftPayload(updatedDraft, documents);

    return res.status(200).json({
      ...payload,
      draft: updatedDraft,
      message: '펀딩 임시저장 처리가 완료되었습니다.',
    });

    const result = await pool.query(
      `
      UPDATE funding_drafts
      SET
        title = CASE WHEN $1::boolean THEN $2 ELSE title END,
        short_title = CASE WHEN $3::boolean THEN $4 ELSE short_title END,
        category = CASE WHEN $5::boolean THEN $6 ELSE category END,
        main_ingredient = CASE WHEN $7::boolean THEN $8 ELSE main_ingredient END,
        sub_ingredients = CASE WHEN $9::boolean THEN $10 ELSE sub_ingredients END,
        alcohol_percentage = CASE WHEN $11::boolean THEN $12 ELSE alcohol_percentage END,
        summary = CASE WHEN $13::boolean THEN $14 ELSE summary END,
        thumbnail_url = CASE WHEN $15::boolean THEN $16 ELSE thumbnail_url END,
        image_urls = CASE WHEN $17::boolean THEN $18 ELSE image_urls END,
        tags = CASE WHEN $19::boolean THEN $20 ELSE tags END,
        budget_plan = CASE WHEN $21::boolean THEN $22 ELSE budget_plan END,
        schedule_plan = CASE WHEN $23::boolean THEN $24 ELSE schedule_plan END,
        refund_policy = CASE WHEN $25::boolean THEN $26 ELSE refund_policy END,
        exchange_policy = CASE WHEN $25::boolean THEN $26 ELSE exchange_policy END,
        progress_rate = GREATEST(progress_rate, $27),
        updated_at = CURRENT_TIMESTAMP
      WHERE draft_id = $28
      RETURNING
        draft_id,
        title,
        short_title,
        category,
        main_ingredient,
        sub_ingredients,
        alcohol_percentage,
        summary,
        thumbnail_url,
        image_urls,
        tags,
        budget_plan,
        schedule_plan,
        refund_policy,
        exchange_policy,
        status,
        progress_rate,
        updated_at
      `,
      [
        hasTitle,
        title ?? null,
        hasShortTitle,
        shortTitle ?? null,
        hasCategory,
        category ?? null,
        hasMainIngredient,
        mainIngredient ?? null,
        hasSubIngredients,
        hasSubIngredients ? normalizeJsonStorageValue(normalizedSubIngredients, []) : null,
        hasAlcoholPercentage,
        alcoholPercentage !== undefined && alcoholPercentage !== null && alcoholPercentage !== ''
          ? Number(alcoholPercentage)
          : null,
        hasSummary,
        summary ?? null,
        hasThumbnailUrl,
        nextThumbnailUrl ?? null,
        hasImageUrls,
        hasImageUrls ? normalizeJsonStorageValue(normalizedImageUrls, []) : null,
        hasTags,
        hasTags ? normalizeJsonStorageValue(normalizedTags, []) : null,
        hasBudgetPlan,
        hasBudgetPlan ? normalizeOriginalTextField(budgetPlan) : null,
        hasSchedulePlan,
        hasSchedulePlan ? normalizeOriginalTextField(schedulePlan) : null,
        hasPolicy,
        hasPolicy ? normalizeOriginalTextField(policy) : null,
        progressRate,
        Number(draftId),
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 임시저장을 찾을 수 없습니다.',
      });
    }

    const draft = result.rows[0];
    await syncFundingProjectFieldsFromDraft(draft.draft_id);
    const imageFields = buildImageFields(draft.thumbnail_url, draft.image_urls);

    return res.status(200).json({
      draftId: draft.draft_id,
      status: draft.status,
      progressRate: draft.progress_rate,
      updatedAt: draft.updated_at,
      draft: {
        title: draft.title,
        shortTitle: draft.short_title,
        category: draft.category,
        mainIngredient: draft.main_ingredient,
        subIngredients: parseFundingListField(draft.sub_ingredients),
        alcoholPercentage: draft.alcohol_percentage,
        summary: draft.summary,
        thumbnailUrl: imageFields.thumbnailUrl,
        imageUrls: imageFields.imageUrls,
        allImageUrls: imageFields.allImageUrls,
        images: mapFundingImageUrls(imageFields.allImageUrls),
        tags: parseJsonField(draft.tags),
        budgetPlan: parseOriginalTextField(draft.budget_plan),
        schedulePlan: parseOriginalTextField(draft.schedule_plan),
        policy: selectProjectPolicyText(draft.refund_policy, draft.exchange_policy),
      },
      message: 'Q&A 댓글 좋아요 성공',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '펀딩 임시저장 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 펀딩 임시저장 처리 로직
const saveBasicInfo = async (req, res) => {
  const { draftId } = req.params;
  const body = req.body || {};
  const title = getBodyValue(body, ['title']);
  const shortTitle = getBodyValue(body, ['shortTitle', 'short_title']);
  const category = getBodyValue(body, ['category']);
  const mainIngredient = getBodyValue(body, ['mainIngredient', 'main_ingredient']);
  const subIngredients = getBodyValue(body, ['subIngredients', 'sub_ingredients']);
  const alcoholPercentage = getBodyValue(body, [
    'alcoholDegree',
    'alcoholContent',
    'alcoholPercentage',
    'alcohol_percentage',
    'abv',
  ]);
  const summary = getBodyValue(body, ['projectSummary', 'summary', 'description']);
  const thumbnailUrl = getBodyValue(body, [
    'representativeImageUrl',
    'representative_image_url',
    'thumbnailUrl',
    'thumbnail_url',
    'imageUrl',
    'image_url',
  ]);
  const imageUrls = getBodyValue(body, ['imageUrls', 'image_urls', 'images']);
  const tags = getBodyValue(body, ['searchTags', 'search_tags', 'tags']);

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (!category || !title || !mainIngredient || !alcoholPercentage || !summary) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (subIngredients && !Array.isArray(subIngredients) && typeof subIngredients !== 'string') {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (imageUrls && !Array.isArray(imageUrls) && typeof imageUrls !== 'string') {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (imageUrls && normalizeFundingImageUrlsInput(imageUrls).length > 5) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (tags && !Array.isArray(tags) && typeof tags !== 'string') {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const normalizedImageUrls = normalizeFundingImageUrlsInput(imageUrls || []);
  const normalizedThumbnailUrl =
    normalizePublicImageUrl(thumbnailUrl) || normalizedImageUrls[0] || null;
  const hasImageUrls = hasOwn(body, 'imageUrls')
    || hasOwn(body, 'image_urls')
    || hasOwn(body, 'images');
  const hasThumbnailUrl = hasOwn(body, 'representativeImageUrl')
    || hasOwn(body, 'representative_image_url')
    || hasOwn(body, 'thumbnailUrl')
    || hasOwn(body, 'thumbnail_url')
    || hasOwn(body, 'imageUrl')
    || hasOwn(body, 'image_url')
    || hasImageUrls;
  const hasTags = hasOwn(body, 'searchTags')
    || hasOwn(body, 'search_tags')
    || hasOwn(body, 'tags');

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res, getRequestedFundingIdFromRequest(req)))) return;

    const result = await pool.query(
      `
      UPDATE funding_drafts
      SET
        title = $1,
        short_title = $2,
        category = $3,
        main_ingredient = $4,
        sub_ingredients = $5,
        alcohol_percentage = $6,
        summary = $7,
        thumbnail_url = CASE WHEN $11::boolean THEN $8 ELSE thumbnail_url END,
        image_urls = CASE WHEN $12::boolean THEN $9 ELSE image_urls END,
        tags = CASE WHEN $13::boolean THEN $10 ELSE tags END,
        progress_rate = GREATEST(progress_rate, 33),
        updated_at = CURRENT_TIMESTAMP
      WHERE draft_id = $14
      RETURNING
        draft_id,
        title,
        short_title,
        category,
        main_ingredient,
        sub_ingredients,
        alcohol_percentage,
        summary,
        thumbnail_url,
        image_urls,
        tags,
        progress_rate,
        updated_at
      `,
      [
        title,
        shortTitle || null,
        category,
        mainIngredient,
        normalizeJsonStorageValue(parseFundingListField(subIngredients || []), []),
        Number(alcoholPercentage),
        summary,
        normalizedThumbnailUrl,
        normalizeJsonStorageValue(normalizedImageUrls, []),
        normalizeJsonStorageValue(parseFundingListField(tags || []), []),
        hasThumbnailUrl,
        hasImageUrls,
        hasTags,
        Number(draftId),
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 프로젝트를 찾을 수 없습니다.',
      });
    }

    const draft = result.rows[0];
    const imageFields = buildImageFields(draft.thumbnail_url, draft.image_urls);
    await syncFundingProjectFieldsFromDraft(draft.draft_id);

    return res.status(200).json({
      draftId: draft.draft_id,
      section: 'BASIC_INFO',
      basicInfo: {
        title: draft.title,
        shortTitle: draft.short_title,
        category: draft.category,
        mainIngredient: draft.main_ingredient,
        subIngredients: parseFundingListField(draft.sub_ingredients),
        alcoholPercentage: draft.alcohol_percentage,
        summary: draft.summary,
        thumbnailUrl: imageFields.thumbnailUrl,
        imageUrls: imageFields.imageUrls,
        allImageUrls: imageFields.allImageUrls,
        images: mapFundingImageUrls(imageFields.allImageUrls),
        tags: parseJsonField(draft.tags),
      },
      progressRate: draft.progress_rate,
      updatedAt: draft.updated_at,
      message: '요청 처리 중 오류가 발생했습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '요청 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 펀딩 처리 로직
const saveSchedule = async (req, res) => {
  const { draftId } = req.params;
  const body = req.body || {};
  const pricePerBottle = getBodyValue(body, [
    'bottleUnitPrice',
    'unitPrice',
    'pricePerBottle',
    'price_per_bottle',
  ]);
  const totalQuantity = getBodyValue(body, [
    'totalSalesQuantity',
    'totalQuantity',
    'quantity',
    'total_quantity',
  ]);
  const fundingStartDate = getBodyValue(body, [
    'fundingStartDate',
    'funding_start_date',
    'startDate',
    'start_date',
  ]);
  const fundingPeriodDays = getBodyValue(body, [
    'projectDuration',
    'fundingPeriodDays',
    'funding_period_days',
  ]);
  const expectedDeliveryDate = getBodyValue(body, [
    'expectedDeliveryStartDate',
    'expectedDeliveryDate',
    'expected_delivery_date',
  ]);
  const scheduleSummary = getBodyValue(body, ['scheduleSummary', 'schedule_summary']);
  const hasScheduleSummary = hasOwn(body, 'scheduleSummary') || hasOwn(body, 'schedule_summary');
  const platformFeeRate = getBodyValue(body, ['platformFeeRate', 'platform_fee_rate']);
  const shippingFee = getBodyValue(body, ['shippingFee', 'shipping_fee']);

  if (
    !draftId ||
    isNaN(Number(draftId)) ||
    !pricePerBottle ||
    !totalQuantity ||
    !fundingStartDate ||
    !fundingPeriodDays ||
    !expectedDeliveryDate
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const pricePerBottleNumber = Number(pricePerBottle);
  const totalQuantityNumber = Number(totalQuantity);
  const fundingPeriodDaysNumber = Number(fundingPeriodDays);

  if (
    !Number.isInteger(pricePerBottleNumber) ||
    !Number.isInteger(totalQuantityNumber) ||
    !Number.isInteger(fundingPeriodDaysNumber) ||
    pricePerBottleNumber <= 0 ||
    totalQuantityNumber <= 0 ||
    fundingPeriodDaysNumber < 1 ||
    fundingPeriodDaysNumber > 365
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const startDate = new Date(fundingStartDate);

  if (Number.isNaN(startDate.getTime())) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + fundingPeriodDaysNumber);

  const deliveryDate = new Date(expectedDeliveryDate);

  if (Number.isNaN(deliveryDate.getTime())) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (deliveryDate <= endDate) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const targetAmount = pricePerBottleNumber * totalQuantityNumber;
  const normalizedPlatformFeeRate = platformFeeRate !== undefined
    ? Number(platformFeeRate)
    : 7;
  const normalizedShippingFee = shippingFee !== undefined
    ? Number(shippingFee)
    : 3000;
  const platformFeeAmount = Math.round(targetAmount * (normalizedPlatformFeeRate / 100));

  if (
    Number.isNaN(normalizedPlatformFeeRate) ||
    normalizedPlatformFeeRate < 0 ||
    Number.isNaN(normalizedShippingFee) ||
    normalizedShippingFee < 0
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const formatDate = (date) => date.toISOString().slice(0, 10);

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res, getRequestedFundingIdFromRequest(req)))) return;

    const result = await pool.query(
      `
      UPDATE funding_drafts
      SET
        price_per_bottle = $1,
        total_quantity = $2,
        target_amount = $3,
        funding_start_date = $4,
        funding_period_days = $5,
        funding_end_date = $6,
        expected_delivery_date = $7,
        platform_fee_rate = $8,
        platform_fee_amount = $9,
        shipping_fee = $10,
        schedule_summary = CASE WHEN $11::boolean THEN $12 ELSE schedule_summary END,
        progress_rate = GREATEST(progress_rate, 47),
        updated_at = CURRENT_TIMESTAMP
      WHERE draft_id = $13
      RETURNING
        draft_id,
        price_per_bottle,
        total_quantity,
        target_amount,
        funding_start_date,
        funding_period_days,
        funding_end_date,
        expected_delivery_date,
        schedule_summary,
        platform_fee_rate,
        platform_fee_amount,
        shipping_fee,
        progress_rate,
        updated_at
      `,
      [
        pricePerBottleNumber,
        totalQuantityNumber,
        targetAmount,
        formatDate(startDate),
        fundingPeriodDaysNumber,
        formatDate(endDate),
        formatDate(deliveryDate),
        normalizedPlatformFeeRate,
        platformFeeAmount,
        normalizedShippingFee,
        hasScheduleSummary,
        normalizeOriginalTextField(scheduleSummary),
        Number(draftId),
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 프로젝트를 찾을 수 없습니다.',
      });
    }

    const draft = result.rows[0];
    await syncFundingProjectFieldsFromDraft(draft.draft_id);

    return res.status(200).json({
      draftId: draft.draft_id,
      section: 'SCHEDULE',
      schedule: {
        pricePerBottle: draft.price_per_bottle,
        totalQuantity: draft.total_quantity,
        targetAmount: draft.target_amount,
        fundingStartDate: draft.funding_start_date,
        fundingPeriodDays: draft.funding_period_days,
        projectDuration: draft.funding_period_days,
        fundingEndDate: draft.funding_end_date,
        expectedDeliveryDate: draft.expected_delivery_date,
        expectedDeliveryStartDate: draft.expected_delivery_date,
        scheduleSummary: draft.schedule_summary,
        platformFeeRate: draft.platform_fee_rate,
        platformFeeAmount: draft.platform_fee_amount,
        shippingFee: draft.shipping_fee,
      },
      platformFeeRate: draft.platform_fee_rate,
      platformFeeAmount,
      shippingFee: draft.shipping_fee,
      progressRate: draft.progress_rate,
      updatedAt: draft.updated_at,
      message: '요청 처리 중 오류가 발생했습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '요청 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 펀딩 처리 로직
const saveLegalInfo = async (req, res) => {
  const { draftId } = req.params;
  const body = req.body || {};
  const productType = getBodyValue(body, ['productType', 'product_type']);
  const volume = getBodyValue(body, ['volume']);
  const alcoholPercentage = getBodyValue(body, [
    'alcoholDegree',
    'alcoholContent',
    'alcoholPercentage',
    'alcohol_percentage',
    'abv',
  ]);
  const rawMaterials = getBodyValue(body, ['rawMaterials', 'raw_materials']);
  const normalizedRawMaterials = parseFundingRawMaterialsField(rawMaterials);

  if (
    !draftId ||
    isNaN(Number(draftId)) ||
    !productType ||
    volume === undefined ||
    alcoholPercentage === undefined
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (
    Number(volume) <= 0 ||
    Number(alcoholPercentage) <= 0 ||
    Number(alcoholPercentage) > 100
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (normalizedRawMaterials.length === 0) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const hasInvalidMaterial = normalizedRawMaterials.some(
    (material) => !material.name || !material.origin
  );

  if (hasInvalidMaterial) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res, getRequestedFundingIdFromRequest(req)))) return;

    const result = await pool.query(
      `
      UPDATE funding_drafts
      SET
        product_type = $1,
        volume = $2,
        alcohol_percentage = $3,
        raw_materials = $4,
        progress_rate = GREATEST(progress_rate, 57),
        updated_at = CURRENT_TIMESTAMP
      WHERE draft_id = $5
      RETURNING
        draft_id,
        product_type,
        volume,
        alcohol_percentage,
        raw_materials,
        progress_rate,
        updated_at
      `,
      [
        productType,
        Number(volume),
        Number(alcoholPercentage),
        JSON.stringify(normalizedRawMaterials),
        Number(draftId),
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 프로젝트를 찾을 수 없습니다.',
      });
    }

    const draft = result.rows[0];
    await syncFundingProjectFieldsFromDraft(draft.draft_id);

    return res.status(200).json({
      draftId: draft.draft_id,
      section: 'LEGAL_INFO',
      productType: draft.product_type,
      volume: draft.volume,
      alcoholPercentage: draft.alcohol_percentage,
      rawMaterials: parseFundingRawMaterialsField(draft.raw_materials),
      progressRate: draft.progress_rate,
      updatedAt: draft.updated_at,
      message: '요청 처리 중 오류가 발생했습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '요청 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 처리 로직
const saveTasteProfile = async (req, res) => {
  const { draftId } = req.params;
  const bodyPayload = req.body || {};

  const {
    sweetness,
    acidity,
    body,
    carbonation,
    alcoholIntensity,
    alcohol,
    flavor,
    aromaIntensity,
    aroma_intensity: aromaIntensitySnake,
    finish,
    aftertaste,
    flavorNotes,
    flavorTags,
    tasteInput,
    tasteVector,
  } = bodyPayload;
  const normalizedAlcoholIntensity = alcoholIntensity ?? alcohol;
  const normalizedAromaIntensity = aromaIntensity ?? aromaIntensitySnake;
  const normalizedFinish = finish ?? aftertaste;

  if (
    !draftId ||
    isNaN(Number(draftId)) ||
    sweetness === undefined ||
    acidity === undefined ||
    body === undefined ||
    carbonation === undefined ||
    (normalizedAlcoholIntensity === undefined && normalizedFinish === undefined)
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const tasteValues = [
    sweetness,
    acidity,
    body,
    carbonation,
    ...(normalizedAlcoholIntensity !== undefined ? [normalizedAlcoholIntensity] : []),
    ...(flavor !== undefined ? [flavor] : []),
    ...(normalizedAromaIntensity !== undefined ? [normalizedAromaIntensity] : []),
    ...(normalizedFinish !== undefined ? [normalizedFinish] : []),
  ];

  const isOutOfRange = tasteValues.some((value) => {
    const numberValue = Number(value);
    return (
      Number.isNaN(numberValue) ||
      numberValue < 0 ||
      numberValue > 100
    );
  });

  if (isOutOfRange) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (flavorNotes && !Array.isArray(flavorNotes) && typeof flavorNotes !== 'string') {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (flavorTags && !Array.isArray(flavorTags) && typeof flavorTags !== 'string') {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res, getRequestedFundingIdFromRequest(req)))) return;

    const currentResult = await pool.query(
      `
      SELECT flavor_notes
      FROM funding_drafts
      WHERE draft_id = $1
      `,
      [Number(draftId)]
    );
    const currentExtras = parseTasteProfileExtras(currentResult.rows[0]?.flavor_notes);
    const flavorNotesPayload = buildTasteProfileStorage({
      flavorNotes: hasOwn(bodyPayload, 'flavorNotes') ? flavorNotes : currentExtras.flavorNotes,
      flavorTags: hasOwn(bodyPayload, 'flavorTags') ? flavorTags : currentExtras.flavorTags,
      flavor: hasOwn(bodyPayload, 'flavor') ? flavor : currentExtras.flavor,
      aromaIntensity: hasOwn(bodyPayload, 'aromaIntensity') || hasOwn(bodyPayload, 'aroma_intensity')
        ? normalizedAromaIntensity
        : currentExtras.aromaIntensity,
      finish: hasOwn(bodyPayload, 'finish') || hasOwn(bodyPayload, 'aftertaste')
        ? normalizedFinish
        : currentExtras.finish,
      tasteInput: hasOwn(bodyPayload, 'tasteInput') ? tasteInput : currentExtras.tasteInput,
      tasteVector: hasOwn(bodyPayload, 'tasteVector') ? tasteVector : currentExtras.tasteVector,
    });

    const result = await pool.query(
      `
      UPDATE funding_drafts
      SET
        sweetness = $1,
        acidity = $2,
        body = $3,
        carbonation = $4,
        alcohol_intensity = COALESCE($5, alcohol_intensity),
        flavor_notes = $6,
        progress_rate = GREATEST(progress_rate, 64),
        updated_at = CURRENT_TIMESTAMP
      WHERE draft_id = $7
      RETURNING
        draft_id,
        sweetness,
        acidity,
        body,
        carbonation,
        alcohol_intensity,
        flavor_notes,
        progress_rate,
        updated_at
      `,
      [
        Number(sweetness),
        Number(acidity),
        Number(body),
        Number(carbonation),
        normalizedAlcoholIntensity === undefined ? null : Number(normalizedAlcoholIntensity),
        flavorNotesPayload,
        Number(draftId),
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 프로젝트를 찾을 수 없습니다.',
      });
    }

    const draft = result.rows[0];
    await syncTasteProfileFromDraft(draft.draft_id);

    return res.status(200).json({
      draftId: draft.draft_id,
      section: 'TASTE_PROFILE',
      tasteProfile: buildTasteProfileResponse(draft),
      progressRate: draft.progress_rate,
      updatedAt: draft.updated_at,
      message: '요청 처리가 완료되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '요청 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 처리 로직
const savePlan = async (req, res) => {
  const { draftId } = req.params;
  const bodyPayload = req.body || {};

  const introduction = getBodyValue(bodyPayload, ['introduction', 'projectDescription', 'projectIntroduction']);
  const videoUrl = getBodyValue(bodyPayload, ['videoUrl', 'video_url', 'projectVideoUrl', 'project_video_url']);
  const budgetPlan = getBodyValue(bodyPayload, ['budgetPlan', 'budget_plan', 'projectBudget']);
  const schedulePlan = getBodyValue(bodyPayload, ['projectSchedule', 'schedulePlan', 'schedule_plan']);
  const policy = getBodyValue(bodyPayload, ['policy', 'projectPolicy']);
  const hasIntroduction = hasOwn(bodyPayload, 'introduction') || hasOwn(bodyPayload, 'projectDescription') || hasOwn(bodyPayload, 'projectIntroduction');
  const hasVideoUrl = hasOwn(bodyPayload, 'videoUrl') || hasOwn(bodyPayload, 'video_url') || hasOwn(bodyPayload, 'projectVideoUrl') || hasOwn(bodyPayload, 'project_video_url');
  const hasBudgetPlan = hasOwn(bodyPayload, 'budgetPlan') || hasOwn(bodyPayload, 'budget_plan') || hasOwn(bodyPayload, 'projectBudget');
  const hasSchedulePlan = hasOwn(bodyPayload, 'projectSchedule') || hasOwn(bodyPayload, 'schedulePlan') || hasOwn(bodyPayload, 'schedule_plan');
  const hasPolicy = hasOwn(bodyPayload, 'policy') || hasOwn(bodyPayload, 'projectPolicy');

  if (
    !draftId ||
    isNaN(Number(draftId)) ||
    !(hasIntroduction || hasVideoUrl || hasBudgetPlan || hasSchedulePlan || hasPolicy)
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res, getRequestedFundingIdFromRequest(req)))) return;

    const result = await pool.query(
      `
      UPDATE funding_drafts
      SET
        introduction = CASE WHEN $1::boolean THEN $2 ELSE introduction END,
        budget_plan = CASE WHEN $3::boolean THEN $4 ELSE budget_plan END,
        schedule_plan = CASE WHEN $5::boolean THEN $6 ELSE schedule_plan END,
        video_url = CASE WHEN $7::boolean THEN $8 ELSE video_url END,
        refund_policy = CASE WHEN $9::boolean THEN $10 ELSE refund_policy END,
        exchange_policy = CASE WHEN $9::boolean THEN $10 ELSE exchange_policy END,
        progress_rate = GREATEST(progress_rate, 78),
        updated_at = CURRENT_TIMESTAMP
      WHERE draft_id = $11
      RETURNING
        draft_id,
        introduction,
        video_url,
        budget_plan,
        schedule_plan,
        refund_policy,
        exchange_policy,
        progress_rate,
        updated_at
      `,
      [
        hasIntroduction,
        normalizeOriginalTextField(introduction),
        hasBudgetPlan,
        normalizeOriginalTextField(budgetPlan),
        hasSchedulePlan,
        normalizeOriginalTextField(schedulePlan),
        hasVideoUrl,
        videoUrl || null,
        hasPolicy,
        normalizeOriginalTextField(policy),
        Number(draftId),
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 프로젝트를 찾을 수 없습니다.',
      });
    }

    const draft = result.rows[0];
    await syncFundingProjectFieldsFromDraft(draft.draft_id);
    const projectPolicy = selectProjectPolicyText(draft.refund_policy, draft.exchange_policy);

    return res.status(200).json({
      draftId: draft.draft_id,
      section: 'PLAN',
      plan: {
        introduction: draft.introduction,
        videoUrl: draft.video_url,
        budgetPlan: parseOriginalTextField(draft.budget_plan),
        projectBudget: parseOriginalTextField(draft.budget_plan),
        schedulePlan: parseOriginalTextField(draft.schedule_plan),
        projectSchedule: parseOriginalTextField(draft.schedule_plan),
        policy: projectPolicy,
        projectPolicy,
        ...PLAN_GUIDES,
      },
      progressRate: draft.progress_rate,
      updatedAt: draft.updated_at,
      message: '요청 처리 중 오류가 발생했습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '요청 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 처리 로직
const saveBreweryInfo = async (req, res) => {
  const { draftId } = req.params;
  const body = req.body || {};

  const breweryName = toTrimmedString(getBodyValue(body, ['breweryName', 'brewery_name']));
  const representativeName = toTrimmedString(
    getBodyValue(body, ['representativeName', 'representative_name'])
  );
  const businessRegistrationNumber = toTrimmedString(
    getBodyValue(body, ['businessRegistrationNumber', 'business_registration_number'])
  );
  const businessAddress = toTrimmedString(
    getBodyValue(body, ['businessAddress', 'business_address'])
  );
  const businessAddressDetail = toTrimmedString(
    getBodyValue(body, ['businessAddressDetail', 'business_address_detail'])
  );
  const contactEmail = toTrimmedString(getBodyValue(body, ['contactEmail', 'contact_email', 'email']));
  const contactPhone = toTrimmedString(getBodyValue(body, ['contactPhone', 'contact_phone']));
  const bankName = toTrimmedString(getBodyValue(body, ['bankName', 'bank_name']));
  const accountNumber = toTrimmedString(getBodyValue(body, ['accountNumber', 'account_number']));
  const accountHolder = toTrimmedString(
    getBodyValue(body, ['accountHolder', 'account_holder']) || representativeName
  );
  const bankVerificationToken = toTrimmedString(
    getBodyValue(body, [
      'bankVerificationToken',
      'bank_verification_token',
      'accountVerificationToken',
      'account_verification_token',
    ])
  );
  const breweryProfileImageUrl = getBodyValue(body, [
    'breweryProfileImageUrl',
    'brewery_profile_image_url',
    'profileImageUrl',
    'profile_image_url',
  ]);
  const breweryBio = getBodyValue(body, ['breweryBio', 'brewery_bio', 'creatorIntroduction', 'creator_introduction']);
  const businessClassification = getBodyValue(body, [
    'businessClassification',
    'business_classification',
    'businessType',
    'business_type',
  ]);
  const businessType = getBodyValue(body, ['businessType', 'business_type']);
  const businessName = getBodyValue(body, ['companyName', 'company_name', 'businessName', 'business_name']);
  const businessCategory = getBodyValue(body, ['businessCategory', 'business_category']);
  const businessItem = getBodyValue(body, ['businessItem', 'business_item']);
  const taxEmail = getBodyValue(body, ['taxEmail', 'tax_email', 'email']);
  const phoneVerified = toRequiredBoolean(
    getBodyValue(body, ['phoneVerified', 'phone_verified'])
  );
  const accountVerified = toRequiredBoolean(
    getBodyValue(body, ['accountVerified', 'account_verified'])
  );

  if (
    !draftId ||
    isNaN(Number(draftId)) ||
    !breweryName ||
    !representativeName ||
    !businessRegistrationNumber ||
    !businessAddress ||
    !contactEmail ||
    !contactPhone ||
    !bankName ||
    !accountNumber ||
    !accountHolder
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const normalizedBusinessNumber = businessRegistrationNumber.replace(/\D/g, '');
  const normalizedPhone = contactPhone.replace(/\D/g, '');
  const normalizedAccountNumber = normalizeComparableAccountNumber(accountNumber);

  if (!/^\d{10}$/.test(normalizedBusinessNumber)) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (!/^01\d{8,9}$/.test(normalizedPhone)) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (normalizedAccountNumber.length < 8) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res, getRequestedFundingIdFromRequest(req)))) return;

    // MVP simple verification: bank account owner check is skipped for demo.
    // Replace this with a real bank account verification provider before production.
    let resolvedAccountVerified = true;

    if (bankVerificationToken) {
      const verificationResult = await pool.query(
        `
        SELECT verification_id
        FROM funding_bank_account_verifications
        WHERE verification_token = $1
          AND status = 'VERIFIED'
          AND bank_name = $2
          AND regexp_replace(account_number, '[^0-9]', '', 'g') = $3
          AND account_holder = $4
        LIMIT 1
        `,
        [
          bankVerificationToken,
          bankName,
          normalizedAccountNumber,
          accountHolder,
        ]
      );

      if (verificationResult.rows.length === 0) {
        return res.status(400).json({
          status: 400,
          message: '요청 값이 올바르지 않습니다.',
        });
      }

      resolvedAccountVerified = true;
    }

    const result = await pool.query(
      `
      UPDATE funding_drafts
      SET
        brewery_name = $1,
        representative_name = $2,
        business_registration_number = $3,
        business_address = $4,
        business_address_detail = $5,
        contact_email = $6,
        contact_phone = $7,
        bank_name = $8,
        account_number = $9,
        account_holder = $10,
        profile_image_url = $11,
        creator_introduction = $12,
        business_type = $13,
        business_name = $14,
        business_category = $15,
        business_item = $16,
        business_classification = $17,
        tax_email = $18,
        phone_verified = $19,
        account_verified = $20,
        creator_name = COALESCE(creator_name, $1),
        progress_rate = GREATEST(progress_rate, 85),
        updated_at = CURRENT_TIMESTAMP
      WHERE draft_id = $21
      RETURNING *
      `,
      [
        breweryName,
        representativeName,
        businessRegistrationNumber,
        businessAddress,
        businessAddressDetail || null,
        contactEmail,
        contactPhone,
        bankName,
        normalizedAccountNumber,
        accountHolder,
        breweryProfileImageUrl || null,
        breweryBio || null,
        businessType || null,
        businessName || breweryName,
        businessCategory || null,
        businessItem || null,
        businessClassification || null,
        taxEmail || contactEmail || null,
        phoneVerified,
        resolvedAccountVerified,
        Number(draftId),
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 프로젝트를 찾을 수 없습니다.',
      });
    }

    const draft = result.rows[0];
    await syncFundingProjectFieldsFromDraft(draft.draft_id);

    return res.status(200).json({
      draftId: draft.draft_id,
      section: 'BREWERY_INFO',
      breweryName: draft.brewery_name,
      representativeName: draft.representative_name,
      businessRegistrationNumber: draft.business_registration_number,
      businessAddress: draft.business_address,
      businessAddressDetail: draft.business_address_detail,
      contactEmail: draft.contact_email,
      contactPhone: draft.contact_phone,
      bankName: draft.bank_name,
      accountNumber: draft.account_number,
      accountHolder: draft.account_holder,
      breweryProfileImageUrl: draft.profile_image_url,
      breweryBio: draft.creator_introduction,
      creatorIntroduction: draft.creator_introduction,
      businessClassification: draft.business_classification,
      businessType: draft.business_type,
      businessName: draft.business_name,
      businessCategory: draft.business_category,
      businessItem: draft.business_item,
      taxEmail: draft.tax_email,
      phoneVerified: draft.phone_verified,
      accountVerified: draft.account_verified,
      progressRate: draft.progress_rate,
      updatedAt: draft.updated_at,
      message: '요청 처리 중 오류가 발생했습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '요청 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 처리 로직
const loadBreweryInfo = async (req, res) => {
  const { draftId } = req.params;

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res, getRequestedFundingIdFromRequest(req)))) return;

    const { rows } = await pool.query(
      `
      SELECT
        fd.brewery_id,
        fd.brewery_name,
        fd.creator_name,
        fd.creator_introduction,
        fd.business_name,
        fd.business_registration_number,
        fd.representative_name,
        fd.business_address,
        fd.business_address_detail,
        fd.contact_email,
        fd.contact_phone,
        fd.bank_name,
        fd.account_number,
        fd.account_holder,
        fd.phone_verified,
        fd.account_verified,
        fd.business_classification,
        fd.business_type,
        fd.business_category,
        fd.business_item,
        fd.identity_document_url,
        fd.business_registration_file_url,
        u.email AS user_email,
        u.phone_number AS user_phone_number,
        ba.application_id AS approved_application_id,
        ba.brewery_name AS approved_brewery_name,
        ba.location AS approved_brewery_location,
        ba.license_number AS approved_license_number,
        ba.business_address_detail AS approved_business_address_detail,
        ba.phone_number AS approved_phone_number,
        ba.document_url AS approved_business_registration_file_url
      FROM funding_drafts fd
      JOIN users u ON u.user_id = fd.brewery_id
      LEFT JOIN LATERAL (
        SELECT
          application_id,
          brewery_name,
          location,
          license_number,
          business_address_detail,
          phone_number,
          document_url
        FROM brewery_auth
        WHERE user_id = fd.brewery_id
          AND status = 'APPROVED'
        ORDER BY
          updated_at DESC,
          application_id DESC
        LIMIT 1
      ) ba ON TRUE
      WHERE fd.draft_id = $1
      `,
      [Number(draftId)]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 프로젝트를 찾을 수 없습니다.',
      });
    }

    const info = rows[0];

    if (!info.approved_application_id) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 프로젝트를 찾을 수 없습니다.',
      });
    }

    const breweryName = info.approved_brewery_name || info.brewery_name || null;
    const representativeName = info.representative_name || null;
    const businessRegistrationNumber = info.approved_license_number || info.business_registration_number || null;
    const businessAddress = info.approved_brewery_location || info.business_address || null;
    const businessAddressDetail = info.approved_business_address_detail || info.business_address_detail || null;
    const contactEmail = info.contact_email || info.user_email || null;
    const contactPhone = info.contact_phone || info.approved_phone_number || info.user_phone_number || null;
    const businessRegistrationFileUrl = info.business_registration_file_url || info.approved_business_registration_file_url || null;
    const businessName = info.business_name || info.brewery_name || info.approved_brewery_name || null;

    const missingFields = [
      ...(breweryName ? [] : ['breweryName']),
      ...(representativeName ? [] : ['representativeName']),
      ...(businessRegistrationNumber ? [] : ['businessRegistrationNumber']),
      ...(businessAddress ? [] : ['businessAddress']),
      ...(businessAddressDetail ? [] : ['businessAddressDetail']),
      ...(contactEmail ? [] : ['contactEmail']),
      ...(contactPhone ? [] : ['contactPhone']),
      ...(info.bank_name ? [] : ['bankName']),
      ...(info.account_number ? [] : ['accountNumber']),
      ...(info.account_holder ? [] : ['accountHolder']),
      ...(info.business_classification || info.business_type ? [] : ['businessClassification']),
      ...(businessName ? [] : ['businessName']),
      ...(info.business_category ? [] : ['businessCategory']),
      ...(info.business_item ? [] : ['businessItem']),
      ...(info.creator_introduction ? [] : ['creatorIntroduction']),
      ...(info.phone_verified ? [] : ['phoneVerified']),
      ...(info.account_verified ? [] : ['accountVerified']),
      ...(businessRegistrationFileUrl ? [] : ['businessRegistrationFileUrl']),
    ];

    return res.status(200).json({
      status: 200,
      message: '펀딩 목록 조회 성공',
      data: {
        breweryName,
        representativeName,
        businessRegistrationNumber,
        businessAddress,
        businessAddressDetail,
        contactEmail,
        contactPhone,
        bankName: info.bank_name,
        accountNumber: info.account_number,
        accountHolder: info.account_holder,
        businessClassification: info.business_classification || info.business_type,
        businessType: info.business_type,
        businessName,
        businessCategory: info.business_category,
        businessItem: info.business_item,
        creatorIntroduction: info.creator_introduction,
        phoneVerified: !!info.phone_verified,
        accountVerified: !!info.account_verified,
        businessRegistrationFileUrl,
        businessLicenseUrl: businessRegistrationFileUrl,
        missingFields,
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '요청 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
const uploadFundingDraftFile = async (req, res) => {
  const { draftId } = req.params;
  const { fileType } = req.body;
  const file = req.file;

  const allowedFileTypes = [
    'PROJECT_IMAGE',
    'FUNDING_IMAGE',
    'PROFILE_IMAGE',
    'IDENTITY_DOCUMENT',
    'BUSINESS_REGISTRATION',
  ];

  if (!draftId || isNaN(Number(draftId)) || !fileType) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (!allowedFileTypes.includes(fileType)) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (!file) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  let updateColumn = null;

  if (fileType === 'PROFILE_IMAGE') {
    updateColumn = 'profile_image_url';
  }

  if (fileType === 'IDENTITY_DOCUMENT') {
    updateColumn = 'identity_document_url';
  }

  if (fileType === 'BUSINESS_REGISTRATION') {
    updateColumn = 'business_registration_file_url';
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res, getRequestedFundingIdFromRequest(req)))) return;

    const fileUrl = await storeUploadedFile(file, `funding-drafts/${draftId}`, draftId);

    if (fileType === 'PROJECT_IMAGE' || fileType === 'FUNDING_IMAGE') {
      const currentResult = await pool.query(
        `
        SELECT thumbnail_url, image_urls
        FROM funding_drafts
        WHERE draft_id = $1
        `,
        [Number(draftId)]
      );

      const currentDraft = currentResult.rows[0];

      if (!currentDraft) {
        return res.status(404).json({
          status: 404,
          message: '펀딩 임시저장을 찾을 수 없습니다.',
        });
      }

      const currentImageUrls = normalizeFundingImageUrlsInput(currentDraft.image_urls);

      if (currentImageUrls.length >= 5) {
        return res.status(400).json({
          status: 400,
          message: '요청 값이 올바르지 않습니다.',
        });
      }

      const nextImageFields = buildImageFields(
        currentDraft.thumbnail_url || fileUrl,
        [...currentImageUrls, fileUrl]
      );

      const result = await pool.query(
        `
        UPDATE funding_drafts
        SET
          thumbnail_url = $1,
          image_urls = $2,
          updated_at = CURRENT_TIMESTAMP
        WHERE draft_id = $3
        RETURNING draft_id, thumbnail_url, image_urls, updated_at
        `,
        [
          nextImageFields.thumbnailUrl,
          normalizeJsonStorageValue(nextImageFields.allImageUrls, []),
          Number(draftId),
        ]
      );

      const draft = result.rows[0];
      await syncFundingProjectFieldsFromDraft(draft.draft_id);

      return res.status(201).json({
        draftId: draft.draft_id,
        fileType,
        fileUrl,
        thumbnailUrl: nextImageFields.thumbnailUrl,
        imageUrls: nextImageFields.imageUrls,
        allImageUrls: nextImageFields.allImageUrls,
        images: mapFundingImageUrls(nextImageFields.allImageUrls),
        updatedAt: draft.updated_at,
        message: '요청 처리 중 오류가 발생했습니다.',
      });
    }

    const result = await pool.query(
      `
      UPDATE funding_drafts
      SET ${updateColumn} = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE draft_id = $2
      RETURNING draft_id, ${updateColumn}, updated_at
      `,
      [fileUrl, Number(draftId)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 임시저장을 찾을 수 없습니다.',
      });
    }

    return res.status(201).json({
      draftId: result.rows[0].draft_id,
      fileType,
      fileUrl,
      updatedAt: result.rows[0].updated_at,
      message: '펀딩 임시저장 처리가 완료되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '파일 업로드 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 펀딩 임시저장 AI 이미지 생성 API
const generateFundingDraftAiImage = async (req, res) => {
  const { draftId } = req.params;

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '펀딩 임시저장 ID가 올바르지 않습니다.',
    });
  }

  try {
    await assertFundingDraftOwner(draftId, req.user);

    const draftResult = await pool.query(
      `
      SELECT
        draft_id,
        brewery_id,
        funding_id,
        title,
        short_title,
        summary,
        introduction,
        flavor_notes,
        tags,
        main_ingredient,
        sub_ingredients,
        business_address,
        thumbnail_url,
        image_urls
      FROM funding_drafts
      WHERE draft_id = $1
      `,
      [Number(draftId)]
    );

    const draft = draftResult.rows[0];

    if (!draft) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 임시저장을 찾을 수 없습니다.',
      });
    }

    const currentImageUrls = normalizeFundingImageUrlsInput(draft.image_urls);

    if (currentImageUrls.length >= 5) {
      return res.status(400).json({
        status: 400,
        message: '펀딩 이미지는 최대 5개까지 등록할 수 있습니다.',
      });
    }

    const aiPayload = normalizeFundingAiImagePayload(req.body || {}, draft);

    if (!aiPayload.name) {
      return res.status(400).json({
        status: 400,
        message: 'AI 이미지 생성을 위해 펀딩명을 입력해주세요.',
      });
    }

    const aiResult = await generateFundingDraftAiImageAndUpload({
      payload: aiPayload,
      userId: getAuthUserId(req.user) || draft.brewery_id,
    });

    const currentImageFields = buildImageFields(draft.thumbnail_url, currentImageUrls);

    if (aiResult.aiStatus === 'prompt_only') {
      return res.status(200).json({
        status: 200,
        message: aiResult.message || 'AI 이미지 생성 프롬프트가 생성되었습니다.',
        data: {
          aiStatus: aiResult.aiStatus,
          promptUsed: aiResult.promptUsed,
          modelUsed: aiResult.modelUsed,
          thumbnailUrl: currentImageFields.thumbnailUrl,
          imageUrls: currentImageFields.imageUrls,
          allImageUrls: currentImageFields.allImageUrls,
          images: mapFundingImageUrls(currentImageFields.allImageUrls),
        },
      });
    }

    const nextImageFields = buildImageFields(
      draft.thumbnail_url || aiResult.imageUrl,
      [...currentImageUrls, aiResult.imageUrl]
    );

    const updateResult = await pool.query(
      `
      UPDATE funding_drafts
      SET
        thumbnail_url = $1,
        image_urls = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE draft_id = $3
      RETURNING draft_id, thumbnail_url, image_urls, updated_at
      `,
      [
        nextImageFields.thumbnailUrl,
        normalizeJsonStorageValue(nextImageFields.allImageUrls, []),
        Number(draftId),
      ]
    );

    const updatedDraft = updateResult.rows[0];
    await syncFundingProjectFieldsFromDraft(updatedDraft.draft_id);

    return res.status(200).json({
      status: 200,
      message: 'AI 이미지가 생성되었습니다.',
      data: {
        imageUrl: aiResult.imageUrl,
        imageKey: aiResult.imageKey,
        mimeType: aiResult.mimeType,
        promptUsed: aiResult.promptUsed,
        modelUsed: aiResult.modelUsed,
        thumbnailUrl: nextImageFields.thumbnailUrl,
        imageUrls: nextImageFields.imageUrls,
        allImageUrls: nextImageFields.allImageUrls,
        images: mapFundingImageUrls(nextImageFields.allImageUrls),
        updatedAt: updatedDraft.updated_at,
      },
    });
  } catch (error) {
    if (handleAuthorizationError(res, error)) {
      return;
    }

    const status = error.statusCode || error.status || 500;
    console.error(error.stack || error);

    return res.status(status).json({
      status,
      message: status === 500
        ? 'AI 이미지 생성 중 오류가 발생했습니다.'
        : error.message,
    });
  }
};

const verifyPhoneForFundingDraft = async (req, res) => {
  const { draftId } = req.params;
  const { contactPhone } = req.body;

  if (!draftId || isNaN(Number(draftId)) || !contactPhone) {
    return res.status(400).json({
      status: 400,
      message: '펀딩 임시저장 ID와 전화번호를 입력해주세요.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res, getRequestedFundingIdFromRequest(req)))) return;

    const result = await pool.query(
      `
      UPDATE funding_drafts
      SET
        contact_phone = $1,
        phone_verified = TRUE,
        updated_at = CURRENT_TIMESTAMP
      WHERE draft_id = $2
      RETURNING draft_id, contact_phone, phone_verified, updated_at
      `,
      [contactPhone, Number(draftId)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 임시저장을 찾을 수 없습니다.',
      });
    }

    const draft = result.rows[0];
    await syncFundingProjectFieldsFromDraft(draft.draft_id);

    return res.status(200).json({
      draftId: draft.draft_id,
      contactPhone: draft.contact_phone,
      phoneVerified: draft.phone_verified,
      updatedAt: draft.updated_at,
      message: '전화번호 인증이 완료되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '전화번호 인증 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 펀딩 임시저장 입금 계좌 인증 처리
const verifyAccountForFundingDraft = async (req, res) => {
  const { draftId } = req.params;
  const {
    bankName,
    accountNumber,
    accountHolder,
    bankVerificationToken,
    bank_verification_token: snakeBankVerificationToken,
    accountVerificationToken,
    account_verification_token: snakeAccountVerificationToken,
  } = req.body || {};
  const normalizedBankName = toTrimmedString(bankName);
  const normalizedAccountHolder = toTrimmedString(accountHolder);
  const resolvedBankVerificationToken = toTrimmedString(
    bankVerificationToken
    || snakeBankVerificationToken
    || accountVerificationToken
    || snakeAccountVerificationToken
  );
  const normalizedAccountNumber = normalizeComparableAccountNumber(accountNumber);

  if (
    !draftId ||
    isNaN(Number(draftId)) ||
    !normalizedBankName ||
    !normalizedAccountNumber ||
    !normalizedAccountHolder
  ) {
    return res.status(400).json({
      status: 400,
      verified: false,
      message: '은행명, 계좌번호, 예금주명을 모두 입력해주세요.',
    });
  }

  if (normalizedAccountNumber.length < 8) {
    return res.status(400).json({
      status: 400,
      verified: false,
      message: '계좌번호는 숫자 기준 8자리 이상 입력해주세요.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res, getRequestedFundingIdFromRequest(req)))) return;

    if (resolvedBankVerificationToken) {
      const verificationResult = await pool.query(
        `
        SELECT verification_id
        FROM funding_bank_account_verifications
        WHERE verification_token = $1
          AND status = 'VERIFIED'
          AND bank_name = $2
          AND regexp_replace(account_number, '[^0-9]', '', 'g') = $3
          AND account_holder = $4
        LIMIT 1
        `,
        [
          resolvedBankVerificationToken,
          normalizedBankName,
          normalizedAccountNumber,
          normalizedAccountHolder,
        ]
      );

      if (verificationResult.rows.length === 0) {
        return res.status(400).json({
          status: 400,
          verified: false,
          message: '계좌 인증 정보가 일치하지 않습니다. 다시 인증해주세요.',
        });
      }
    }

    // MVP simple verification. Replace this with a real bank account owner check before production.
    const result = await pool.query(
      `
      UPDATE funding_drafts
      SET
        bank_name = $1,
        account_number = $2,
        account_holder = $3,
        account_verified = TRUE,
        updated_at = CURRENT_TIMESTAMP
      WHERE draft_id = $4
      RETURNING
        draft_id,
        bank_name,
        account_number,
        account_holder,
        account_verified,
        updated_at
      `,
      [normalizedBankName, normalizedAccountNumber, normalizedAccountHolder, Number(draftId)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 임시저장을 찾을 수 없습니다.',
      });
    }

    const draft = result.rows[0];

    return res.status(200).json({
      status: 200,
      verified: true,
      draftId: Number(draft.draft_id),
      bankName: draft.bank_name,
      accountNumber: draft.account_number,
      accountHolder: draft.account_holder,
      accountVerified: draft.account_verified,
      updatedAt: draft.updated_at,
      message: '입금 계좌 인증이 완료되었습니다.',
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      status: error.status || 500,
      message: error.message || '입금 계좌 인증 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const requestBankAccountVerification = async (req, res) => {
  const userId = getNullableUserId(req);
  const {
    bankName,
    accountNumber,
    normalizedAccountNumber,
    accountHolder,
  } = getBankVerificationFields(req.body);

  if (!bankName || !accountNumber || !normalizedAccountNumber || !accountHolder) {
    return res.status(400).json({
      status: 400,
      message: '은행명, 계좌번호, 예금주명을 모두 입력해주세요.',
    });
  }

  const verificationCode = createBankVerificationCode();
  const ttlMinutes = getBankVerificationTtlMinutes();

  try {
    await pool.query(
      `
      UPDATE funding_bank_account_verifications
      SET
        status = 'EXPIRED',
        updated_at = CURRENT_TIMESTAMP
      WHERE status = 'PENDING'
        AND expires_at <= CURRENT_TIMESTAMP
      `
    );

    const result = await pool.query(
      `
      INSERT INTO funding_bank_account_verifications (
        user_id,
        bank_name,
        account_number,
        account_holder,
        verification_code,
        status,
        requested_at,
        expires_at,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        'PENDING',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP + ($6::int * INTERVAL '1 minute'),
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      RETURNING
        verification_id,
        bank_name,
        account_number,
        account_holder,
        status,
        requested_at,
        expires_at
      `,
      [
        userId,
        bankName,
        accountNumber,
        accountHolder,
        verificationCode,
        ttlMinutes,
      ]
    );

    const verification = result.rows[0];
    const response = {
      verificationId: Number(verification.verification_id),
      bankName: verification.bank_name,
      accountNumber: verification.account_number,
      accountHolder: verification.account_holder,
      verified: false,
      accountVerified: false,
      bankVerificationToken: null,
      status: verification.status,
      requestedAt: verification.requested_at,
      expiresAt: verification.expires_at,
      message: '계좌 인증 요청이 생성되었습니다.',
    };

    if (shouldExposeBankVerificationCode()) {
      response.verificationCode = verificationCode;
      response.devMessage = '개발 환경에서만 계좌 인증번호가 응답에 포함됩니다.';
    }

    return res.status(201).json(response);
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '계좌 인증 요청 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const confirmBankAccountVerification = async (req, res) => {
  const userId = getNullableUserId(req);
  const body = req.body || {};
  const verificationId = Number(getBodyValue(body, ['verificationId', 'verification_id']));
  const verificationCode = toTrimmedString(
    getBodyValue(body, [
      'verificationCode',
      'verification_code',
      'code',
      'senderCode',
      'sender_code',
    ])
  );
  const {
    bankName,
    accountNumber,
    normalizedAccountNumber,
    accountHolder,
  } = getBankVerificationFields(body);

  if (!bankName || !accountNumber || !normalizedAccountNumber || !accountHolder || !verificationCode) {
    return res.status(400).json({
      status: 400,
      message: '은행명, 계좌번호, 예금주명, 인증번호를 모두 입력해주세요.',
    });
  }

  try {
    await pool.query(
      `
      UPDATE funding_bank_account_verifications
      SET
        status = 'EXPIRED',
        updated_at = CURRENT_TIMESTAMP
      WHERE status = 'PENDING'
        AND expires_at <= CURRENT_TIMESTAMP
      `
    );

    const verificationResult = await pool.query(
      `
      SELECT
        verification_id,
        bank_name,
        account_number,
        account_holder,
        verification_code
      FROM funding_bank_account_verifications
      WHERE status = 'PENDING'
        AND bank_name = $1
        AND regexp_replace(account_number, '[^0-9]', '', 'g') = $2
        AND account_holder = $3
        AND expires_at > CURRENT_TIMESTAMP
        AND user_id IS NOT DISTINCT FROM $4
        AND ($5::bigint IS NULL OR verification_id = $5)
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [
        bankName,
        normalizedAccountNumber,
        accountHolder,
        userId,
        Number.isInteger(verificationId) && verificationId > 0 ? verificationId : null,
      ]
    );

    if (verificationResult.rows.length === 0) {
      return res.status(400).json({
        status: 400,
        message: '인증번호가 만료되었습니다. 다시 요청해주세요.',
      });
    }

    const verification = verificationResult.rows[0];

    if (verification.verification_code !== verificationCode) {
      return res.status(400).json({
        status: 400,
        message: '인증번호가 일치하지 않습니다.',
      });
    }

    const bankVerificationToken = createBankVerificationToken();
    const updateResult = await pool.query(
      `
      UPDATE funding_bank_account_verifications
      SET
        status = 'VERIFIED',
        verification_token = $2,
        confirmed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE verification_id = $1
      RETURNING
        verification_id,
        bank_name,
        account_number,
        account_holder,
        status,
        verification_token,
        confirmed_at
      `,
      [Number(verification.verification_id), bankVerificationToken]
    );

    const confirmed = updateResult.rows[0];

    return res.status(200).json({
      verificationId: Number(confirmed.verification_id),
      bankName: confirmed.bank_name,
      accountNumber: confirmed.account_number,
      accountHolder: confirmed.account_holder,
      verified: true,
      accountVerified: true,
      bankVerificationToken: confirmed.verification_token,
      status: confirmed.status,
      confirmedAt: confirmed.confirmed_at,
      message: '계좌 인증번호 확인이 완료되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '계좌 인증번호 확인 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 공지 및 정책 저장
const saveNotices = async (req, res) => {
  const { draftId } = req.params;
  const bodyPayload = req.body || {};

  const refundPolicy = getBodyValue(bodyPayload, ['refundPolicy', 'refund_policy']);
  const exchangePolicy = getBodyValue(bodyPayload, ['exchangePolicy', 'exchange_policy']);
  const adultVerificationNotice = getBodyValue(bodyPayload, [
    'adultVerificationNotice',
    'adult_verification_notice',
  ]);
  const riskNotice = getBodyValue(bodyPayload, [
    'expectedDifficulties',
    'expected_difficulties',
    'risks',
    'riskPlan',
    'risk_plan',
    'riskNotice',
    'risk_notice',
  ]);
  const explicitProjectPolicyCandidate = getExplicitProjectPolicyCandidate(bodyPayload);
  const normalizedPolicy = explicitProjectPolicyCandidate.exists
    ? explicitProjectPolicyCandidate.value
    : undefined;
  const normalizedRefundPolicy = normalizedPolicy ?? refundPolicy;
  const normalizedExchangePolicy = normalizedPolicy ?? exchangePolicy;

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (
    !normalizedRefundPolicy ||
    !normalizedExchangePolicy ||
    !adultVerificationNotice ||
    !riskNotice
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res, getRequestedFundingIdFromRequest(req)))) return;

    const result = await pool.query(
      `
      UPDATE funding_drafts
      SET
        refund_policy = $1,
        exchange_policy = $2,
        adult_verification_notice = $3,
        risk_notice = $4,
        progress_rate = GREATEST(progress_rate, 92),
        updated_at = CURRENT_TIMESTAMP
      WHERE draft_id = $5
      RETURNING
        draft_id,
        refund_policy,
        exchange_policy,
        adult_verification_notice,
        risk_notice,
        progress_rate,
        updated_at
      `,
      [
        normalizeOriginalTextField(normalizedRefundPolicy),
        normalizeOriginalTextField(normalizedExchangePolicy),
        adultVerificationNotice,
        riskNotice,
        Number(draftId),
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 프로젝트를 찾을 수 없습니다.',
      });
    }

    const draft = result.rows[0];
    const responseProjectPolicy = selectProjectPolicyText(draft.refund_policy, draft.exchange_policy);

    return res.status(200).json({
      draftId: draft.draft_id,
      section: 'NOTICES',
      policy: responseProjectPolicy,
      projectPolicy: responseProjectPolicy,
      refundPolicy: responseProjectPolicy,
      exchangePolicy: responseProjectPolicy,
      adultVerificationNotice: draft.adult_verification_notice,
      riskNotice: draft.risk_notice,
      progressRate: draft.progress_rate,
      updatedAt: draft.updated_at,
      message: '펀딩 공지 및 정책 저장이 완료되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '공지 저장 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 서류 업로드
const uploadDocument = async (req, res) => {
  const { draftId } = req.params;
  const { documentType } = req.body || {};
  const file = req.file;
  const normalizedDocumentType = normalizeFundingDocumentType(documentType);

  if (!draftId || isNaN(Number(draftId)) || !documentType) {
    return res.status(400).json({
      status: 400,
      message: '펀딩 임시저장 ID와 서류 유형을 입력해주세요.',
    });
  }

  if (!normalizedDocumentType) {
    return res.status(400).json({
      status: 400,
      message: '지원하지 않는 서류 유형입니다.',
    });
  }

  if (!file) {
    return res.status(400).json({
      status: 400,
      message: '파일을 업로드해주세요.',
    });
  }

  const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png'];

  if (!allowedMimeTypes.includes(file.mimetype)) {
    return res.status(400).json({
      status: 400,
      message: 'PDF, JPG, PNG 형식의 파일만 업로드할 수 있습니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res, getRequestedFundingIdFromRequest(req)))) return;

    const fileUrl = await storeUploadedFile(file, `funding-documents/${draftId}`, draftId);

    const result = await pool.query(
      `
      INSERT INTO funding_documents (
        draft_id,
        document_type,
        file_name,
        file_url,
        mime_type,
        file_size
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        document_id,
        draft_id,
        document_type,
        file_name,
        file_url,
        mime_type,
        file_size,
        created_at
      `,
      [
        Number(draftId),
        normalizedDocumentType,
        file.originalname,
        fileUrl,
        file.mimetype,
        file.size,
      ]
    );

    let document = result.rows[0];
    let ocr = null;

    if (normalizedDocumentType === 'BUSINESS_LICENSE') {
      const ocrReview = await runFundingDocumentOcr({
        file,
        documentUrl: fileUrl,
      });

      try {
        const updatedDocument = await saveFundingDocumentOcrResult(document.document_id, ocrReview);
        document = updatedDocument || document;
        ocr = buildFundingDocumentOcrResponse(document);
      } catch (ocrSaveError) {
        console.warn('Funding document OCR result save failed', {
          documentId: document.document_id,
          draftId: document.draft_id,
          message: ocrSaveError.message,
        });

        ocr = {
          status: 'FAILED',
          message: 'OCR 처리에 실패했습니다.',
          summary: 'OCR 처리에 실패했습니다.',
          extractedFields: null,
          result: ocrReview.result || null,
          processedAt: null,
        };
      }
    }

    const requiredDocumentResult = await pool.query(
      `
      SELECT DISTINCT document_type
      FROM funding_documents
      WHERE draft_id = $1
      AND document_type = ANY($2::text[])
      `,
      [Number(draftId), REQUIRED_FUNDING_DOCUMENT_TYPES]
    );

    const uploadedRequiredTypes = requiredDocumentResult.rows.map(
      (row) => row.document_type
    );

    const isAllRequiredDocumentsUploaded = REQUIRED_FUNDING_DOCUMENT_TYPES.every((type) =>
      uploadedRequiredTypes.includes(type)
    );

    let progressRate = null;

    if (isAllRequiredDocumentsUploaded) {
      const progressResult = await pool.query(
        `
        UPDATE funding_drafts
        SET
          progress_rate = 100,
          updated_at = CURRENT_TIMESTAMP
        WHERE draft_id = $1
        RETURNING progress_rate
        `,
        [Number(draftId)]
      );

      progressRate = progressResult.rows[0]?.progress_rate || 100;
    }

    return res.status(201).json({
      draftId: document.draft_id,
      documentId: document.document_id,
      documentType: document.document_type,
      fileName: document.file_name,
      fileUrl: document.file_url,
      mimeType: document.mime_type,
      fileSize: document.file_size,
      requiredDocuments: {
        requiredTypes: REQUIRED_FUNDING_DOCUMENT_TYPES,
        uploadedTypes: uploadedRequiredTypes,
        completed: isAllRequiredDocumentsUploaded,
      },
      progressRate,
      createdAt: document.created_at,
      ocr,
      message: '펀딩 서류 업로드가 완료되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '펀딩 서류 업로드 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 심사 제출 처리
// 임시저장 데이터를 기반으로 레시피와 펀딩 프로젝트를 생성합니다.
const submitFundingDraft = async (req, res) => {
  const { draftId } = req.params;

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '펀딩 임시저장 ID가 올바르지 않습니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res, getRequestedFundingIdFromRequest(req)))) return;

    const draftResult = await pool.query(
      `
      SELECT *
      FROM funding_drafts
      WHERE draft_id = $1
      `,
      [Number(draftId)]
    );

    if (draftResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 임시저장을 찾을 수 없습니다.',
      });
    }

    const draft = draftResult.rows[0];

    if (draft.status === 'SUBMITTED') {
      if (draft.funding_id) {
        const fundingResult = await pool.query(
          `
          SELECT
            funding_id,
            title,
            status,
            goal_amount,
            current_amount,
            start_date,
            end_date,
            price_per_bottle,
            shipping_fee,
            created_at
          FROM funding_projects
          WHERE funding_id = $1
          `,
          [Number(draft.funding_id)]
        );
        const funding = fundingResult.rows[0] || {};
        const responseData = {
          draftId: Number(draft.draft_id),
          fundingId: Number(draft.funding_id),
          numericFundingId: Number(draft.funding_id),
          recipeId: draft.recipe_id === null || draft.recipe_id === undefined
            ? null
            : Number(draft.recipe_id),
          status: draft.status,
          fundingStatus: funding.status || null,
          progressRate: Number(draft.progress_rate || 0),
          submittedAt: draft.submitted_at,
          updatedAt: draft.updated_at,
          funding: funding.funding_id
            ? {
              fundingId: Number(funding.funding_id),
              numericFundingId: Number(funding.funding_id),
              title: funding.title,
              status: funding.status,
              goalAmount: funding.goal_amount,
              currentAmount: funding.current_amount,
              startDate: funding.start_date,
              endDate: funding.end_date,
              pricePerBottle: funding.price_per_bottle,
              shippingFee: funding.shipping_fee,
              createdAt: funding.created_at,
            }
            : null,
        };

        return res.status(200).json({
          status: 200,
          message: '이미 심사 제출된 펀딩입니다.',
          data: responseData,
          draftId: responseData.draftId,
          fundingId: responseData.fundingId,
          numericFundingId: responseData.numericFundingId,
          recipeId: responseData.recipeId,
          draftStatus: responseData.status,
          fundingStatus: responseData.fundingStatus,
          progressRate: responseData.progressRate,
          submittedAt: responseData.submittedAt,
          updatedAt: responseData.updatedAt,
          funding: responseData.funding,
        });
      }

      return res.status(400).json({
        status: 400,
        message: '이미 제출된 펀딩 임시저장입니다.',
      });
    }

    if (Number(draft.progress_rate) < 100) {
      return res.status(400).json({
        status: 400,
        message: '필수 정보를 모두 입력한 뒤 심사 제출해주세요.',
      });
    }

    const documentResult = await pool.query(
      `
      SELECT DISTINCT document_type
      FROM funding_documents
      WHERE draft_id = $1
      AND document_type = ANY($2::text[])
      `,
      [Number(draftId), REQUIRED_FUNDING_DOCUMENT_TYPES]
    );

    const uploadedTypes = documentResult.rows.map((row) => row.document_type);

    const hasAllRequiredDocuments = REQUIRED_FUNDING_DOCUMENT_TYPES.every((type) =>
      uploadedTypes.includes(type)
    );

    if (!hasAllRequiredDocuments) {
      return res.status(400).json({
        status: 400,
        message: '필수 서류를 모두 업로드한 뒤 심사 제출해주세요.',
        requiredDocuments: REQUIRED_FUNDING_DOCUMENT_TYPES,
        uploadedDocuments: uploadedTypes,
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const breweryUserId = getUserId(req) || Number(draft.brewery_id);

      if (!Number.isInteger(Number(breweryUserId)) || Number(breweryUserId) <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          status: 400,
          message: '양조장 사용자 정보를 확인할 수 없어 심사 제출할 수 없습니다.',
        });
      }

      // 드래프트에 저장된 원본 레시피 ID를 그대로 사용한다.
      // recipe_id가 없으면 직접 만든 펀딩으로 보고 null로 처리한다.
      const recipeId = (draft.recipe_id != null && Number(draft.recipe_id) > 0)
        ? Number(draft.recipe_id)
        : null;

      const fundingResult = await client.query(
        `
        INSERT INTO funding_projects (
          brewery_user_id,
          recipe_id,
          title,
          short_title,
          description,
          goal_amount,
          current_amount,
          start_date,
          end_date,
          summary,
          category,
          thumbnail_url,
          image_urls,
          expected_delivery_date,
          price_per_bottle,
          shipping_fee,
          volume,
          alcohol_percentage,
          status,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17,
          'REVIEWING',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        RETURNING
          funding_id,
          title,
          short_title,
          status,
          goal_amount,
          current_amount,
          start_date,
          end_date,
          summary,
          category,
          thumbnail_url,
          image_urls,
          expected_delivery_date,
          price_per_bottle,
          shipping_fee,
          volume,
          alcohol_percentage,
          created_at
        `,
        [
          breweryUserId,
          recipeId,
          draft.title,
          draft.short_title || null,
          draft.summary || draft.introduction || '',
          Number(draft.target_amount || 0),
          draft.funding_start_date,
          draft.funding_end_date,
          draft.summary || '',
          draft.category || null,
          draft.thumbnail_url || null,
          normalizeJsonStorageValue(normalizeFundingImageUrlsInput(draft.image_urls).slice(0, 5), []),
          draft.expected_delivery_date || null,
          Number(draft.price_per_bottle || 0),
          draft.shipping_fee !== null && draft.shipping_fee !== undefined
            ? Number(draft.shipping_fee)
            : 3000,
          draft.volume !== null && draft.volume !== undefined ? Number(draft.volume) : null,
          draft.alcohol_percentage !== null && draft.alcohol_percentage !== undefined
            ? Number(draft.alcohol_percentage)
            : null,
        ]
      );

      const funding = fundingResult.rows[0];

      await client.query(
        `
        INSERT INTO taste_profiles (
          funding_id,
          user_id,
          sweetness,
          acidity,
          body,
          carbonation,
          alcohol_intensity,
          flavor_notes,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        [
          funding.funding_id,
          breweryUserId,
          draft.sweetness,
          draft.acidity,
          draft.body,
          draft.carbonation,
          draft.alcohol_intensity,
          normalizeJsonStorageValue(draft.flavor_notes, []),
        ]
      );

      const submitResult = await client.query(
        `
        UPDATE funding_drafts
        SET
          status = 'SUBMITTED',
          funding_id = $2,
          progress_rate = 100,
          submitted_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE draft_id = $1
        RETURNING draft_id, status, progress_rate, submitted_at, updated_at
        `,
        [Number(draftId), funding.funding_id]
      );

      await client.query('COMMIT');

      const submittedDraft = submitResult.rows[0];
      try {
        await syncFundingProjectFieldsFromDraft(submittedDraft.draft_id);
      } catch (syncError) {
        console.warn('Failed to sync submitted funding management fields', {
          draftId: submittedDraft.draft_id,
          fundingId: funding.funding_id,
          message: syncError.message,
        });
      }

      const responseData = {
        draftId: Number(submittedDraft.draft_id),
        fundingId: Number(funding.funding_id),
        numericFundingId: Number(funding.funding_id),
        recipeId: recipeId !== null ? Number(recipeId) : null,
        status: submittedDraft.status,
        fundingStatus: funding.status,
        progressRate: Number(submittedDraft.progress_rate || 0),
        submittedAt: submittedDraft.submitted_at,
        updatedAt: submittedDraft.updated_at,
        funding: {
          fundingId: Number(funding.funding_id),
          numericFundingId: Number(funding.funding_id),
          title: funding.title,
          status: funding.status,
          goalAmount: funding.goal_amount,
          currentAmount: funding.current_amount,
          startDate: funding.start_date,
          endDate: funding.end_date,
          pricePerBottle: funding.price_per_bottle,
          shippingFee: funding.shipping_fee,
          createdAt: funding.created_at,
        },
      };

      return res.status(200).json({
        status: 200,
        data: responseData,
        draftId: submittedDraft.draft_id,
        fundingId: funding.funding_id,
        numericFundingId: Number(funding.funding_id),
        recipeId,
        draftStatus: responseData.status,
        fundingStatus: funding.status,
        progressRate: submittedDraft.progress_rate,
        submittedAt: submittedDraft.submitted_at,
        updatedAt: submittedDraft.updated_at,
        funding: {
          fundingId: funding.funding_id,
          title: funding.title,
          status: funding.status,
          goalAmount: funding.goal_amount,
          currentAmount: funding.current_amount,
          startDate: funding.start_date,
          endDate: funding.end_date,
          pricePerBottle: funding.price_per_bottle,
          shippingFee: funding.shipping_fee,
          createdAt: funding.created_at,
        },
        message: '펀딩 심사 제출이 완료되었습니다.',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '펀딩 심사 제출 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 임시저장 단건 조회
const getFundingDraft = async (req, res) => {
  const { draftId } = req.params;

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '펀딩 임시저장 ID가 올바르지 않습니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res, getRequestedFundingIdFromRequest(req)))) return;

    const result = await pool.query(
      `
      SELECT *
      FROM funding_drafts
      WHERE draft_id = $1
      `,
      [Number(draftId)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 임시저장을 찾을 수 없습니다.',
      });
    }

    const documentResult = await pool.query(
      `
      SELECT
        document_id,
        draft_id,
        document_type,
        file_name,
        file_url,
        mime_type,
        file_size,
        ocr_status,
        ocr_result,
        ocr_summary,
        ocr_extracted_fields,
        ocr_processed_at,
        created_at
      FROM funding_documents
      WHERE draft_id = $1
      ORDER BY document_id ASC
      `,
      [Number(draftId)]
    );
    const payload = buildFundingDraftPayload(result.rows[0], documentResult.rows);

    return res.status(200).json({
      draft: result.rows[0],
      ...payload,
      message: '펀딩 임시저장 조회 성공',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '펀딩 임시저장 조회 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const getFundingDraftByFundingId = async (req, res) => {
  const { fundingId } = req.params;
  const resolvedFundingId = await resolveFundingId(fundingId);

  if (!resolvedFundingId) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  try {
    if (!(await authorizeFundingProjectOwner(resolvedFundingId, req.user, res))) return;

    const fundingStatusResult = await pool.query(
      `
      SELECT status
      FROM funding_projects
      WHERE funding_id = $1
      LIMIT 1
      `,
      [resolvedFundingId]
    );
    const fundingStatus = fundingStatusResult.rows[0]?.status || null;

    const draft = await findAndLinkFundingDraftByFundingId(resolvedFundingId);

    if (!draft) {
      return res.status(404).json({
        status: 404,
        message: '연결된 펀딩 임시저장을 찾을 수 없습니다.',
      });
    }

    const documents = await getFundingDraftDocuments(draft.draft_id);
    const payload = buildFundingDraftPayload(draft, documents);
    const responseData = {
      ...payload,
      draftStatus: payload.draftStatus || payload.status,
      fundingStatus,
      draft,
    };

    return res.status(200).json({
      ...payload,
      status: 200,
      draftStatus: responseData.draftStatus,
      fundingStatus,
      message: '펀딩 임시저장 조회 성공',
      data: responseData,
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '펀딩 임시저장 조회 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 임시저장 목록 조회
const getFundingDraftList = async (req, res) => {
  const { breweryId } = req.query;

  const currentUserId = getAuthUserId(req.user);

  if (!currentUserId) {
    return res.status(401).json({
      status: 401,
      message: AUTH_REQUIRED_MESSAGE,
    });
  }

  const requestedBreweryId =
    breweryId === undefined || breweryId === null || breweryId === ''
      ? currentUserId
      : Number(breweryId);

  if (!Number.isInteger(requestedBreweryId) || requestedBreweryId <= 0) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (!isAdminUser(req.user) && requestedBreweryId !== currentUserId) {
    return res.status(403).json({
      status: 403,
      message: FUNDING_OWNER_FORBIDDEN_MESSAGE,
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        draft_id,
        brewery_id,
        title,
        short_title,
        category,
        status,
        progress_rate,
        created_at,
        updated_at
      FROM funding_drafts
      WHERE brewery_id = $1
      ORDER BY updated_at DESC
      `,
      [requestedBreweryId]
    );

    return res.status(200).json({
      drafts: result.rows,
      message: '펀딩 임시저장 처리가 완료되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '펀딩 임시저장 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 임시저장 처리 로직
const deleteFundingDraft = async (req, res) => {
  const { draftId } = req.params;

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res, getRequestedFundingIdFromRequest(req)))) return;

    const draftResult = await pool.query(
      `
      SELECT
        fd.draft_id,
        fd.funding_id,
        fd.status,
        fp.status AS funding_status
      FROM funding_drafts fd
      LEFT JOIN funding_projects fp ON fp.funding_id = fd.funding_id
      WHERE fd.draft_id = $1
      `,
      [Number(draftId)]
    );

    const draft = draftResult.rows[0];

    if (!draft) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 임시저장을 찾을 수 없습니다.',
      });
    }

    const protectedStatuses = [
      'SUBMITTED',
      'REVIEWING',
      'APPROVED',
      'ACTIVE',
      'ONGOING',
      'COMPLETED',
      'SUCCESSFUL',
      'CANCELED',
      'CANCELLED',
    ];
    const draftStatus = toTrimmedString(draft.status).toUpperCase();
    const fundingStatus = toTrimmedString(draft.funding_status).toUpperCase();
    const isManagementDraft =
      draft.funding_id !== null ||
      protectedStatuses.includes(draftStatus) ||
      protectedStatuses.includes(fundingStatus);

    if (isManagementDraft) {
      return res.status(409).json({
        status: 409,
        message: '이미 처리된 요청입니다.',
        data: {
          draftId: Number(draft.draft_id),
          fundingId: draft.funding_id === null || draft.funding_id === undefined
            ? null
            : Number(draft.funding_id),
          status: draft.status,
          fundingStatus: draft.funding_status,
          protected: true,
        },
      });
    }

    await pool.query(
      `
      DELETE FROM funding_documents
      WHERE draft_id = $1
      `,
      [Number(draftId)]
    );

    const result = await pool.query(
      `
      DELETE FROM funding_drafts
      WHERE draft_id = $1
      RETURNING draft_id
      `,
      [Number(draftId)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 임시저장을 찾을 수 없습니다.',
      });
    }

    return res.status(200).json({
      draftId: result.rows[0].draft_id,
      message: '펀딩 임시저장 처리가 완료되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '펀딩 임시저장 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 임시저장 처리 로직
const getFundingDraftPreview = async (req, res) => {
  const { draftId } = req.params;

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res, getRequestedFundingIdFromRequest(req)))) return;

    const draftResult = await pool.query(
      `
      SELECT *
      FROM funding_drafts
      WHERE draft_id = $1
      `,
      [Number(draftId)]
    );

    if (draftResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 임시저장을 찾을 수 없습니다.',
      });
    }

    const documentResult = await pool.query(
      `
      SELECT
        document_id,
        draft_id,
        document_type,
        file_name,
        file_url,
        mime_type,
        file_size,
        ocr_status,
        ocr_result,
        ocr_summary,
        ocr_extracted_fields,
        ocr_processed_at,
        created_at
      FROM funding_documents
      WHERE draft_id = $1
      ORDER BY document_id ASC
      `,
      [Number(draftId)]
    );

    const draft = draftResult.rows[0];
    const payload = buildFundingDraftPayload(draft, documentResult.rows);
    const responseData = {
      ...payload,
      draft,
    };

    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      ...payload,
      status: 200,
      draftStatus: payload.status,
      data: responseData,
      message: '펀딩 임시저장 처리가 완료되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '펀딩 임시저장 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 임시저장 처리 로직
const updateFundingProject = async (req, res) => {
  const { fundingId } = req.params;

  const {
    title,
    description,
    thumbnailUrl,
    imageUrls,
    goalAmount,
    startDate,
    endDate,
    pricePerBottle,
    shippingFee,
    status,
  } = req.body;

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const allowedStatuses = ['ONGOING', 'ACTIVE', 'ENDED', 'CANCELED', 'CANCELLED'];

  if (status && !allowedStatuses.includes(status)) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (
    goalAmount !== undefined &&
    (!Number.isInteger(Number(goalAmount)) || Number(goalAmount) < 0)
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (
    pricePerBottle !== undefined &&
    (!Number.isInteger(Number(pricePerBottle)) || Number(pricePerBottle) <= 0)
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (
    shippingFee !== undefined &&
    (!Number.isInteger(Number(shippingFee)) || Number(shippingFee) < 0)
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (imageUrls !== undefined && !Array.isArray(imageUrls) && typeof imageUrls !== 'string') {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (imageUrls && normalizeFundingImageUrlsInput(imageUrls).length > 5) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const normalizedImageFields = imageUrls !== undefined
    ? buildImageFields(thumbnailUrl, imageUrls)
    : null;
  const normalizedThumbnailUrl = thumbnailUrl !== undefined
    ? normalizePublicImageUrl(thumbnailUrl)
    : null;
  const shouldUpdateThumbnail =
    normalizedImageFields !== null ||
    (thumbnailUrl !== undefined && normalizedThumbnailUrl !== null);

  try {
    if (!(await authorizeFundingProjectOwner(fundingId, req.user, res))) return;

    const result = await pool.query(
      `
      UPDATE funding_projects
      SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        goal_amount = COALESCE($3, goal_amount),
        start_date = COALESCE($4, start_date),
        end_date = COALESCE($5, end_date),
        price_per_bottle = COALESCE($6, price_per_bottle),
        shipping_fee = COALESCE($7, shipping_fee),
        status = COALESCE($8, status),
        thumbnail_url = CASE WHEN $9::boolean THEN $10 ELSE thumbnail_url END,
        image_urls = CASE WHEN $11::boolean THEN $12 ELSE image_urls END
      WHERE funding_id = $13
      RETURNING
        funding_id,
        title,
        description,
        goal_amount,
        current_amount,
        start_date,
        end_date,
        price_per_bottle,
        shipping_fee,
        thumbnail_url,
        image_urls,
        status
      `,
      [
        title || null,
        description || null,
        goalAmount !== undefined ? Number(goalAmount) : null,
        startDate || null,
        endDate || null,
        pricePerBottle !== undefined ? Number(pricePerBottle) : null,
        shippingFee !== undefined ? Number(shippingFee) : null,
        status || null,
        shouldUpdateThumbnail,
        normalizedImageFields ? normalizedImageFields.thumbnailUrl : normalizedThumbnailUrl,
        imageUrls !== undefined,
        normalizedImageFields ? JSON.stringify(normalizedImageFields.allImageUrls) : null,
        Number(fundingId),
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 프로젝트를 찾을 수 없습니다.',
      });
    }

    const funding = result.rows[0];
    const aiRecommendation = isAiFundingRegistrationStatus(status)
      ? await registerFundingProjectToAiPool(funding.funding_id)
      : undefined;

    return res.status(200).json({
      fundingId: funding.funding_id,
      title: funding.title,
      description: funding.description,
      goalAmount: funding.goal_amount,
      currentAmount: funding.current_amount,
      startDate: funding.start_date,
      endDate: funding.end_date,
      pricePerBottle: funding.price_per_bottle,
      shippingFee: funding.shipping_fee,
      thumbnailUrl: funding.thumbnail_url,
      imageUrls: buildImageFields(funding.thumbnail_url, funding.image_urls).imageUrls,
      allImageUrls: buildImageFields(funding.thumbnail_url, funding.image_urls).allImageUrls,
      images: mapFundingImageUrls(buildImageFields(funding.thumbnail_url, funding.image_urls).allImageUrls),
      status: funding.status,
      ...(aiRecommendation ? { aiRecommendation } : {}),
      message: '요청 처리 중 오류가 발생했습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '요청 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 처리 로직
const mapFundingListRow = (row) => {
  const currentAmount = Number(row.current_amount || 0);
  const targetAmount = Number(row.target_amount || 0);
  const imageFields = buildImageFields(row.thumbnail_url, row.image_urls);
  const breweryUserId =
    row.brewery_user_id === null || row.brewery_user_id === undefined
      ? null
      : Number(row.brewery_user_id);
  const matchRate = normalizeFundingMatchScore(row.match_rate);

  return {
    fundingId: Number(row.funding_id),
    title: row.title,
    description: row.description,
    breweryUserId,
    ownerUserId: breweryUserId,
    isMine: row.is_mine === true,
    breweryName: row.brewery_name,
    recipeTitle: row.recipe_title,
    thumbnailUrl: imageFields.thumbnailUrl,
    imageUrls: imageFields.imageUrls,
    allImageUrls: imageFields.allImageUrls,
    images: mapFundingImageUrls(imageFields.allImageUrls),
    status: row.status,
    currentAmount,
    targetAmount,
    achievementRate:
      targetAmount > 0 ? Math.floor((currentAmount / targetAmount) * 100) : 0,
    startDate: row.start_date,
    endDate: row.end_date,
    expectedDeliveryDate: row.expected_delivery_date,
    pricePerBottle: row.price_per_bottle,
    shippingFee: row.shipping_fee,
    matchRate,
    sulbtiMatchScore: matchRate,
    matchScore: matchRate,
    tasteMatchScore: matchRate,
    recommendationScore: matchRate,
    matchPercent: matchRate,
    liked: row.liked,
    likeCount: Number(row.like_count || 0),
    supporterCount: Number(row.supporter_count || 0),
    supporter_count: Number(row.supporter_count || 0),
  };
};

const isTruthyQueryValue = (value) => {
  if (Array.isArray(value)) {
    return value.some(isTruthyQueryValue);
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (value === undefined || value === null) {
    return false;
  }

  return ['true', '1', 'yes', 'y', 'on'].includes(String(value).trim().toLowerCase());
};

const getFundingList = async (req, res) => {
  const {
    status,
    sort,
    page = 0,
    size = 10,
    keyword,
    mine,
    isMine,
    my,
    ownerOnly,
    ownedOnly,
    management,
  } = req.query;

  const validFundingSorts = ['RECOMMENDED', 'POPULAR', 'LATEST', 'DEADLINE', 'ID_ASC'];
  const sortAliasMap = {
    RECOMMEND: 'RECOMMENDED',
    RECOMMENDED: 'RECOMMENDED',
    POPULAR: 'POPULAR',
    LATEST: 'LATEST',
    DEADLINE: 'DEADLINE',
    ENDINGSOON: 'DEADLINE',
    ENDING_SOON: 'DEADLINE',
    ID_ASC: 'ID_ASC',
  };
  const requestedSort = typeof sort === 'string' && sort.trim()
    ? sort.trim().replace(/-/g, '_').toUpperCase()
    : 'LATEST';
  const normalizedSort = sortAliasMap[requestedSort] || requestedSort;
  const normalizedKeyword = typeof keyword === 'string' ? keyword.trim() : '';
  const normalizedStatus =
    typeof status === 'string' && status.trim()
      ? status.trim().toUpperCase()
      : null;

  const requestedPageNumber = Number(page);
  const requestedSizeNumber = Number(size);

  if (
    !validFundingSorts.includes(normalizedSort) ||
    !Number.isInteger(requestedPageNumber) ||
    !Number.isInteger(requestedSizeNumber) ||
    requestedPageNumber < 0 ||
    requestedSizeNumber <= 0
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const userId = getUserId(req);
  const mineRequested = [
    mine,
    isMine,
    my,
    ownerOnly,
    ownedOnly,
    management,
  ].some(isTruthyQueryValue);

  if (mineRequested && !userId) {
    return res.status(401).json({
      status: 401,
      message: AUTH_REQUIRED_MESSAGE,
    });
  }

  // 펀딩 탭(공개 목록)에는 진행 중(ACTIVE/ONGOING)·성사(SUCCESS)된 펀딩만 노출한다.
  // 준비(READY)/심사중(REVIEWING)/실패(FAILED)/반려(REJECTED)/취소(CANCELED) 등은 숨긴다.
  // 단, 양조장 본인 관리 목록(mine)은 모든 상태를 볼 수 있어야 하므로 이 제한에서 제외한다.
  const PUBLIC_VISIBLE_STATUSES = ['ACTIVE', 'ONGOING', 'SUCCESS'];
  const ACTIVE_STATUSES = ['ACTIVE', 'ONGOING'];

  const values = [];
  const conditions = [];

  if (mineRequested) {
    if (normalizedStatus) {
      values.push(normalizedStatus);
      conditions.push(`fp.status = $${values.length}`);
    }
  } else {
    // 프론트의 진행중/성사 선택은 그대로 존중하고, 미지정(전체 프로젝트)이거나
    // 비공개 상태를 요청한 경우에도 노출 가능한 상태로만 제한한다.
    let visibleStatuses;
    if (normalizedStatus === 'SUCCESS') {
      visibleStatuses = ['SUCCESS'];
    } else if (normalizedStatus === 'ACTIVE' || normalizedStatus === 'ONGOING') {
      visibleStatuses = ACTIVE_STATUSES;
    } else {
      visibleStatuses = PUBLIC_VISIBLE_STATUSES;
    }
    values.push(visibleStatuses);
    conditions.push(`fp.status = ANY($${values.length}::text[])`);
  }

  if (normalizedKeyword) {
    values.push(`%${normalizedKeyword}%`);
    const keywordParam = `$${values.length}`;
    conditions.push(`(
      fp.title ILIKE ${keywordParam}
      OR COALESCE(fp.description, '') ILIKE ${keywordParam}
      OR COALESCE(NULLIF(bp.brewery_name, ''), ba.brewery_name, u.nickname, '') ILIKE ${keywordParam}
      OR r.title ILIKE ${keywordParam}
    )`);
  }

  if (mineRequested) {
    values.push(userId);
    conditions.push(`fp.brewery_user_id = $${values.length}`);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const baseFromClause = `
    FROM funding_projects fp
    LEFT JOIN recipes r ON r.recipe_id = fp.recipe_id
    LEFT JOIN users u ON u.user_id = fp.brewery_user_id
    LEFT JOIN brewery_profiles bp ON bp.user_id = fp.brewery_user_id
    LEFT JOIN LATERAL (
      SELECT brewery_name
      FROM brewery_auth
      WHERE user_id = fp.brewery_user_id
      ORDER BY
        CASE WHEN status = 'APPROVED' THEN 0 ELSE 1 END,
        updated_at DESC,
        application_id DESC
      LIMIT 1
    ) ba ON TRUE
  `;

  try {
    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS total_count
      ${baseFromClause}
      ${whereClause}
      `,
      values
    );

    const totalElements = countResult.rows[0]?.total_count || 0;

    const listValues = [
      ...values,
      userId,
      requestedSizeNumber,
      requestedPageNumber * requestedSizeNumber,
    ];

    const userIdParam = `$${values.length + 1}`;
    const limitParam = `$${values.length + 2}`;
    const offsetParam = `$${values.length + 3}`;
    const listFromClause = `
      ${baseFromClause}
      LEFT JOIN LATERAL (
        SELECT
          taste_profile_id,
          sweetness,
          acidity,
          body,
          carbonation,
          alcohol_intensity
        FROM taste_profiles
        WHERE funding_id = fp.funding_id
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      ) tp_match ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          result_id,
          sweetness_score,
          body_score,
          carbonation_score,
          abv_score
        FROM sul_bti_results
        WHERE user_id = ${userIdParam}
        ORDER BY updated_at DESC NULLS LAST, created_at DESC, result_id DESC
        LIMIT 1
      ) sb_match ON TRUE
    `;
    const orderBy = {
      RECOMMENDED: 'ORDER BY match_rate DESC, COALESCE(like_counts.like_count, 0) DESC, fp.created_at DESC, fp.funding_id DESC',
      POPULAR: 'ORDER BY COALESCE(like_counts.like_count, 0) DESC, fp.created_at DESC, fp.funding_id DESC',
      LATEST: 'ORDER BY fp.created_at DESC, fp.funding_id DESC',
      DEADLINE: `ORDER BY CASE WHEN fp.end_date >= ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date) THEN 0 ELSE 1 END, fp.end_date ASC NULLS LAST, fp.created_at DESC, fp.funding_id DESC`,
      ID_ASC: 'ORDER BY fp.funding_id ASC',
    }[normalizedSort];

    const { rows } = await pool.query(
      `
      SELECT
        fp.funding_id,
        fp.brewery_user_id,
        fp.title,
        fp.description,
        COALESCE(NULLIF(bp.brewery_name, ''), ba.brewery_name, u.nickname) AS brewery_name,
        r.title AS recipe_title,
        COALESCE(fp.thumbnail_url, r.image_url) AS thumbnail_url,
        fp.image_urls,
        fp.status,
        fp.current_amount,
        fp.supporter_count,
        fp.goal_amount AS target_amount,
        fp.start_date,
        fp.end_date,
        fp.expected_delivery_date,
        fp.price_per_bottle,
        fp.shipping_fee,
        COALESCE(like_counts.like_count, 0) AS like_count,
        COALESCE(
          CASE
            WHEN sb_match.result_id IS NOT NULL AND tp_match.taste_profile_id IS NOT NULL THEN GREATEST(0, LEAST(100, ROUND((
              (100 - ABS(((sb_match.sweetness_score - 1) * 25) - COALESCE(tp_match.sweetness, 50))) +
              (100 - ABS(((sb_match.body_score - 1) * 25) - COALESCE(tp_match.body, 50))) +
              (100 - ABS(((sb_match.carbonation_score - 1) * 25) - COALESCE(tp_match.carbonation, 50))) +
              (100 - ABS(((sb_match.abv_score - 1) * 25) - COALESCE(tp_match.alcohol_intensity, 50)))
            ) / 4.0)::int))
            ELSE 0
          END,
          0
        ) AS match_rate,
        EXISTS (
          SELECT 1
          FROM funding_likes my_like
          WHERE my_like.funding_id = fp.funding_id
          AND my_like.user_id = ${userIdParam}
        ) AS liked,
        CASE
          WHEN ${userIdParam} IS NOT NULL AND fp.brewery_user_id = ${userIdParam}
            THEN true
          ELSE false
        END AS is_mine
      ${listFromClause}
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS like_count
        FROM funding_likes fl
        WHERE fl.funding_id = fp.funding_id
      ) like_counts ON TRUE
      ${whereClause}
      ${orderBy}
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
      `,
      listValues
    );

    const fundings = rows
      .map(mapFundingListRow)
      .filter((funding) => !mineRequested || funding.breweryUserId === userId);

    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      status: 200,
      message: '펀딩 목록 처리가 완료되었습니다.',
      data: fundings,
      page: requestedPageNumber,
      size: requestedSizeNumber,
      totalElements,
      totalPages: Math.ceil(totalElements / requestedSizeNumber),
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '펀딩 목록 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const getFundingStats = async (req, res) => {
  res.set('Content-Type', 'application/json; charset=utf-8');

  try {
    const result = await pool.query(
      `
      WITH paid_orders AS (
        SELECT
          order_id,
          user_id,
          funding_id
        FROM orders
        WHERE order_status = 'PAID'
          AND funding_id IS NOT NULL
      )
      SELECT
        COUNT(*) FILTER (
          WHERE fp.status IN ('ACTIVE', 'ONGOING')
            AND (fp.end_date IS NULL OR fp.end_date >= CURRENT_DATE)
        )::int AS available_funding_count,
        (
          SELECT COUNT(DISTINCT user_id)::int
          FROM paid_orders
          WHERE user_id IS NOT NULL
        ) AS total_supporter_count,
        COUNT(*) FILTER (
          WHERE fp.goal_amount > 0
            AND COALESCE(fp.current_amount, 0) >= fp.goal_amount
        )::int AS successful_project_count,
        COALESCE(SUM(COALESCE(fp.current_amount, 0)), 0)::bigint AS total_raised_amount
      FROM funding_projects fp
      `
    );

    const stats = result.rows[0];
    const totalRaisedAmount = Number(stats.total_raised_amount || 0);
    const responseData = {
      participationAvailableFunding: Number(stats.available_funding_count || 0),
      availableFundingCount: Number(stats.available_funding_count || 0),
      totalSupporterCount: Number(stats.total_supporter_count || 0),
      totalParticipantCount: Number(stats.total_supporter_count || 0),
      successfulProjectCount: Number(stats.successful_project_count || 0),
      totalRaisedAmount,
      totalRaisedHundredMillion: Number((totalRaisedAmount / 100000000).toFixed(1)),
      totalRaisedTenMillion: Number((totalRaisedAmount / 10000000).toFixed(1)),
      totalRaisedTenMillionUnit: '만원',
    };

    return res.status(200).json({
      status: 200,
      message: '요청 처리가 완료되었습니다.',
      data: responseData,
      ...responseData,
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '펀딩 목록 조회 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 상세 조회
const getFundingDetail = async (req, res) => {
  const { fundingId } = req.params;

  const resolvedFundingId = await resolveFundingId(fundingId);

  if (!resolvedFundingId) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  const userId = getUserId(req);

  try {
    await findAndLinkFundingDraftByFundingId(resolvedFundingId);
    const rawMaterialsColumn = await getFundingProjectRawMaterialsColumn();
    const managementColumns = await getFundingProjectManagementColumns();
    const projectRawMaterialsExpression = rawMaterialsColumn
      ? 'fp.raw_materials::text'
      : 'NULL::text';

    const fundingResult = await pool.query(
      `
      SELECT
        fp.funding_id,
        fp.brewery_user_id,
        fp.title,
        fp.description,
        COALESCE(fd.summary, fp.summary) AS summary,
        COALESCE(fd.category, fp.category) AS category,
        COALESCE(NULLIF(fd.image_urls::text, '[]'), NULLIF(fp.image_urls::text, '[]')) AS image_urls,
        fp.status,
        fp.current_amount,
        fp.supporter_count,
        COALESCE(fd.target_amount, fp.goal_amount) AS target_amount,
        COALESCE(fd.funding_start_date, fp.start_date) AS start_date,
        COALESCE(fd.funding_end_date, fp.end_date) AS end_date,
        COALESCE(fd.expected_delivery_date, fp.expected_delivery_date) AS expected_delivery_date,
        COALESCE(fd.price_per_bottle, fp.price_per_bottle) AS price_per_bottle,
        COALESCE(fd.shipping_fee, fp.shipping_fee) AS shipping_fee,
        ${projectManagementColumnSelect(managementColumns, 'total_quantity', 'project_total_quantity')},
        fd.total_quantity,
        COALESCE(fd.volume, fp.volume) AS volume,
        COALESCE(fd.alcohol_percentage, fp.alcohol_percentage) AS alcohol_percentage,
        fp.bottle_size,
        fp.created_at,
        fd.draft_id,
        COALESCE(NULLIF(fd.short_title, ''), NULLIF(fp.short_title, '')) AS short_title,
        COALESCE(NULLIF(fd.main_ingredient, ''), NULLIF(r.main_ingredient, '')) AS main_ingredient,
        COALESCE(NULLIF(fd.sub_ingredients, ''), NULLIF(r.ai_sub_ingredient, '')) AS sub_ingredients,
        fd.tags,
        fd.sweetness,
        fd.acidity,
        fd.body,
        fd.carbonation,
        fd.alcohol_intensity,
        fd.flavor_notes,
        fd.product_type,
        COALESCE(
          NULLIF(NULLIF(BTRIM(fd.raw_materials::text), '[]'), 'null'),
          NULLIF(NULLIF(BTRIM(raw_material_source.raw_materials::text), '[]'), 'null'),
          NULLIF(NULLIF(BTRIM(${projectRawMaterialsExpression}), '[]'), 'null')
        ) AS raw_materials,
        fd.introduction,
        fd.video_url,
        fd.schedule_summary,
        COALESCE(NULLIF(fd.budget_plan, ''), NULLIF(fp.budget_plan, '')) AS budget_plan,
        COALESCE(NULLIF(fd.schedule_plan, ''), NULLIF(fp.schedule_plan, '')) AS schedule_plan,
        COALESCE(NULLIF(fd.refund_policy, ''), NULLIF(fp.refund_policy, '')) AS refund_policy,
        COALESCE(NULLIF(fd.exchange_policy, ''), NULLIF(fp.exchange_policy, '')) AS exchange_policy,
        fd.adult_verification_notice,
        fd.risk_notice,
        fd.business_classification AS draft_business_classification,
        fd.business_type AS draft_business_type,
        fd.business_name AS draft_business_name,
        fd.business_registration_number AS draft_business_registration_number,
        fd.representative_name AS draft_representative_name,
        fd.business_address AS draft_business_address,
        fd.business_category AS draft_business_category,
        fd.business_item AS draft_business_item,
        fd.tax_email AS draft_tax_email,
        fd.business_registration_file_url AS draft_business_registration_file_url,
        COALESCE(NULLIF(bp.brewery_name, ''), ba.brewery_name, u.nickname) AS brewery_name,
        bp.brewery_name AS profile_brewery_name,
        ba.brewery_name AS auth_brewery_name,
        u.nickname AS brewery_nickname,
        bp.profile_image_url,
        bp.one_line_introduction,
        bp.short_introduction,
        bp.brand_story,
        bp.history,
        bp.established_year,
        ba.license_number AS business_registration_number,
        bp.representative_name,
        bp.address AS profile_address,
        ba.location AS auth_location,
        ba.business_address_detail AS auth_business_address_detail,
        r.title AS recipe_title,
        COALESCE(NULLIF(fd.thumbnail_url, ''), NULLIF(fp.thumbnail_url, ''), r.image_url) AS thumbnail_url,
        COALESCE(like_counts.like_count, 0) AS like_count,
        EXISTS (
          SELECT 1
          FROM funding_likes my_like
          WHERE my_like.funding_id = fp.funding_id
          AND my_like.user_id = $2
        ) AS liked
      FROM funding_projects fp
      JOIN recipes r ON r.recipe_id = fp.recipe_id
      JOIN users u ON u.user_id = fp.brewery_user_id
      LEFT JOIN brewery_profiles bp ON bp.user_id = fp.brewery_user_id
      LEFT JOIN LATERAL (
        SELECT *
        FROM funding_drafts fd_inner
        WHERE fd_inner.funding_id = fp.funding_id
        ORDER BY updated_at DESC
        LIMIT 1
      ) fd ON TRUE
      LEFT JOIN LATERAL (
        SELECT fd_raw.raw_materials
        FROM funding_drafts fd_raw
        WHERE fd_raw.funding_id = fp.funding_id
          AND fd_raw.brewery_id = fp.brewery_user_id
          AND fd_raw.raw_materials IS NOT NULL
          AND NULLIF(NULLIF(BTRIM(fd_raw.raw_materials::text), '[]'), 'null') IS NOT NULL
        ORDER BY fd_raw.updated_at DESC
        LIMIT 1
      ) raw_material_source ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          brewery_name,
          location,
          business_address_detail,
          license_number,
          phone_number,
          document_url
        FROM brewery_auth
        WHERE user_id = fp.brewery_user_id
        ORDER BY
          CASE WHEN status = 'APPROVED' THEN 0 ELSE 1 END,
          updated_at DESC,
          application_id DESC
        LIMIT 1
      ) ba ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS like_count
        FROM funding_likes fl
        WHERE fl.funding_id = fp.funding_id
      ) like_counts ON TRUE
      WHERE fp.funding_id = $1
      `,
      [resolvedFundingId, userId]
    );

    if (fundingResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 프로젝트를 찾을 수 없습니다.',
      });
    }

    const funding = fundingResult.rows[0];
    const imageFields = buildImageFields(funding.thumbnail_url, funding.image_urls);
    const {
      mainIngredient,
      primaryIngredient,
      subIngredient,
      subIngredients,
      ingredients,
      rawMaterials,
      ingredientDetails,
    } = buildFundingIngredientContext(funding);

    const optionResult = await pool.query(
      `
      SELECT
        option_id,
        name,
        price,
        description,
        volume,
        alcohol,
        stock,
        remaining_stock,
        max_per_user
      FROM funding_support_options
      WHERE funding_id = $1
      ORDER BY option_id ASC
      `,
      [resolvedFundingId]
    );
    const supportOptionStockTotal = optionResult.rows.reduce(
      (total, option) => total + Number(option.stock || 0),
      0
    );
    const pricePerBottle = funding.price_per_bottle ?? optionResult.rows[0]?.price ?? null;
    const projectTotalQuantity = toNullableNumber(funding.project_total_quantity);
    const draftTotalQuantity = toNullableNumber(funding.total_quantity);
    const totalQuantity = projectTotalQuantity ?? draftTotalQuantity ?? (supportOptionStockTotal > 0 ? supportOptionStockTotal : null);

    const tasteResult = await pool.query(
      `
      SELECT
        sweetness,
        acidity,
        body,
        carbonation,
        alcohol_intensity,
        flavor_notes
      FROM taste_profiles
      WHERE funding_id = $1
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
      `,
      [resolvedFundingId]
    );

    const draftTaste = [
      funding.sweetness,
      funding.acidity,
      funding.body,
      funding.carbonation,
      funding.alcohol_intensity,
      funding.flavor_notes,
    ].some((value) => value !== null && value !== undefined)
      ? {
          sweetness: funding.sweetness,
          acidity: funding.acidity,
          body: funding.body,
          carbonation: funding.carbonation,
          alcohol_intensity: funding.alcohol_intensity,
          flavor_notes: funding.flavor_notes,
        }
      : null;
    const taste = draftTaste || tasteResult.rows[0];
    const sulbtiResult = await pool.query(
      `
      SELECT
        sweetness_score,
        body_score,
        carbonation_score,
        abv_score
      FROM sul_bti_results
      WHERE user_id = $1
      ORDER BY updated_at DESC NULLS LAST, created_at DESC, result_id DESC
      LIMIT 1
      `,
      [userId]
    );
    const matchScore = calculateSulbtiMatchScore(sulbtiResult.rows[0], taste);
    const documentResult = funding.draft_id
      ? await pool.query(
        `
        SELECT
          document_id,
          draft_id,
          document_type,
          file_name,
          file_url,
          mime_type,
          file_size,
          ocr_status,
          ocr_result,
          ocr_summary,
          ocr_extracted_fields,
          ocr_processed_at,
          created_at
        FROM funding_documents
        WHERE draft_id = $1
        ORDER BY document_id ASC
        `,
        [Number(funding.draft_id)]
      )
      : { rows: [] };

    const achievementRate =
      Number(funding.target_amount) > 0
        ? Math.floor(
            (Number(funding.current_amount) / Number(funding.target_amount)) * 100
          )
        : 0;
    const budgetPlan = parseOriginalTextField(funding.budget_plan);
    const schedulePlan = parseOriginalTextField(funding.schedule_plan);
    const projectPolicy = selectProjectPolicyText(funding.refund_policy, funding.exchange_policy);
    const breweryProfile = buildPublicBreweryProfile(funding);
    const tasteProfile = taste
      ? buildTasteProfileResponse({
          ...taste,
          funding_id: funding.funding_id,
          alcohol_percentage: funding.alcohol_percentage,
        })
      : null;
    const tags = parseJsonField(funding.tags);
    const projectSummary = funding.summary || funding.description;
    const fundingPeriodDays = calculateFundingPeriodDays(funding.start_date, funding.end_date);
    const tasteGraph = {
      sweetness: tasteProfile?.sweetness ?? null,
      aftertaste: tasteProfile?.aftertaste ?? null,
      finish: tasteProfile?.finish ?? null,
      acidity: tasteProfile?.acidity ?? null,
      body: tasteProfile?.body ?? null,
      carbonation: tasteProfile?.carbonation ?? null,
    };
    const storyInfo = {
      introduction: funding.introduction,
      projectDescription: funding.introduction,
      budgetPlan,
      projectBudget: budgetPlan,
      videoUrl: funding.video_url,
      projectSchedule: schedulePlan,
      schedulePlan,
    };
    const legalNoticeSource = rawMaterials.length > 0
      ? rawMaterials
      : (funding.volume || funding.alcohol_percentage || mainIngredient
        ? [{ name: mainIngredient || null, origin: null }]
        : []);
    const legalNotices = legalNoticeSource.map((material) => ({
      volume: funding.volume ?? '',
      alcoholDegree: funding.alcohol_percentage ?? null,
      alcoholContent: funding.alcohol_percentage ?? null,
      mainIngredient: material.name || material.mainIngredient || material.main_ingredient || mainIngredient || '',
      origin: material.origin || material.countryOfOrigin || material.country_of_origin || material.region || '',
    }));
    const taxInvoiceInfo = {
      businessClassification: funding.draft_business_classification || null,
      businessType: funding.draft_business_type || null,
      companyName: funding.draft_business_name || null,
      businessName: funding.draft_business_name || null,
      businessRegistrationNumber: funding.draft_business_registration_number || null,
      representativeName: funding.draft_representative_name || null,
      businessAddress: funding.draft_business_address || null,
      businessCategory: funding.draft_business_category || null,
      businessItem: funding.draft_business_item || null,
      email: funding.draft_tax_email || null,
      taxEmail: funding.draft_tax_email || null,
      businessRegistrationFileUrl: funding.draft_business_registration_file_url || null,
    };
    const noticeInfo = {
      projectPolicy,
      policy: projectPolicy,
      expectedDifficulties: funding.risk_notice || null,
      risks: funding.risk_notice || null,
      riskPlan: funding.risk_notice || null,
      riskNotice: funding.risk_notice || null,
    };

    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      fundingId: Number(funding.funding_id),
      title: funding.title,
      summary: funding.summary || funding.description,
      description: funding.description,
      category: funding.category,
      shortTitle: funding.short_title,
      mainIngredient,
      primaryIngredient,
      mainIngredientLabel: MAIN_INGREDIENT_LABEL,
      primaryIngredientLabel: MAIN_INGREDIENT_LABEL,
      subIngredient,
      subIngredients,
      ingredients,
      rawMaterials,
      ingredientDetails,
      tags,
      thumbnailUrl: imageFields.thumbnailUrl,
      imageUrls: imageFields.imageUrls,
      allImageUrls: imageFields.allImageUrls,
      images: mapFundingImageUrls(imageFields.allImageUrls),
      breweryName: breweryProfile.breweryName,
      status: funding.status,
      currentAmount: Number(funding.current_amount),
      targetAmount: Number(funding.target_amount),
      achievementRate,
      startDate: funding.start_date,
      endDate: funding.end_date,
      expectedDeliveryDate: funding.expected_delivery_date,
      pricePerBottle,
      totalQuantity,
      shippingFee: funding.shipping_fee,
      volume: funding.volume,
      alcoholPercentage: funding.alcohol_percentage,
      bottleSize: funding.bottle_size,
      businessAddress: breweryProfile.businessAddress,
      breweryAddress: breweryProfile.businessAddress,
      breweryLocation: breweryProfile.businessAddress,
      matchRate: matchScore,
      sulbtiMatchScore: matchScore,
      matchScore,
      tasteMatchScore: matchScore,
      matchPercent: matchScore,
      recommendationScore: matchScore,
      liked: funding.liked,
      likeCount: Number(funding.like_count || 0),
      supporterCount: Number(funding.supporter_count || 0),
      supporter_count: Number(funding.supporter_count || 0),
      basicInfo: {
        title: funding.title,
        shortTitle: funding.short_title,
        mainIngredient,
        subIngredients,
        alcoholDegree: funding.alcohol_percentage,
        alcoholContent: funding.alcohol_percentage,
        alcoholPercentage: funding.alcohol_percentage,
        summary: projectSummary,
        projectSummary,
        thumbnailUrl: imageFields.thumbnailUrl,
        representativeImageUrl: imageFields.thumbnailUrl,
        searchTags: tags,
        tags,
      },
      fundingInfo: {
        bottleUnitPrice: pricePerBottle,
        unitPrice: pricePerBottle,
        pricePerBottle,
        totalSalesQuantity: totalQuantity,
        totalQuantity,
        quantity: totalQuantity,
        targetAmount: Number(funding.target_amount),
        startDate: funding.start_date,
        fundingStartDate: funding.start_date,
        projectDuration: fundingPeriodDays,
        fundingPeriodDays,
        endDate: funding.end_date,
        fundingEndDate: funding.end_date,
        expectedDeliveryStartDate: funding.expected_delivery_date,
        expectedDeliveryDate: funding.expected_delivery_date,
        scheduleSummary: funding.schedule_summary || null,
      },
      tasteProfile,
      tasteGraph,
      legalNotices,
      legalInfo: {
        productType: funding.product_type,
        volume: funding.volume,
        alcoholPercentage: funding.alcohol_percentage,
        mainIngredient,
        primaryIngredient,
        subIngredient,
        subIngredients,
        ingredients,
        rawMaterials,
        businessNumber: breweryProfile.businessRegistrationNumber,
        licenseNumber: breweryProfile.businessRegistrationNumber,
        businessAddress: breweryProfile.businessAddress,
        businessAddressDetail: breweryProfile.businessAddressDetail,
        notice: funding.adult_verification_notice || funding.risk_notice || null,
        policy: projectPolicy,
        refundPolicy: projectPolicy,
        exchangePolicy: projectPolicy,
      },
      plan: {
        introduction: funding.introduction,
        videoUrl: funding.video_url,
        productionPlan: funding.introduction || null,
        deliveryPlan: funding.expected_delivery_date || null,
        fundingPurpose: funding.introduction || null,
        budgetPlan,
        projectBudget: budgetPlan,
        schedulePlan,
        projectSchedule: schedulePlan,
        riskPlan: funding.risk_notice,
        policy: projectPolicy,
        projectPolicy,
        ...PLAN_GUIDES,
      },
      storyInfo,
      taxInvoiceInfo,
      breweryInfo: breweryProfile,
      breweryProfile,
      notices: {
        refundPolicy: projectPolicy,
        exchangePolicy: projectPolicy,
        adultVerificationNotice: funding.adult_verification_notice,
        riskNotice: funding.risk_notice,
        notice: funding.adult_verification_notice || funding.risk_notice || null,
        policy: projectPolicy,
      },
      noticeInfo,
      documents: documentResult.rows.map(mapFundingDocument),
      supportOptions: buildFundingSupportOptionsResponse({
        options: optionResult.rows,
        funding: {
          ...funding,
          total_quantity: totalQuantity,
        },
        mainIngredient,
        subIngredients,
        ingredients,
      }),
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '펀딩 상세 조회 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 소개 조회
const getFundingIntro = async (req, res) => {
  const { fundingId } = req.params;
  const resolvedFundingId = await resolveFundingId(fundingId);

  // 유효한 펀딩 ID 확인
  if (!resolvedFundingId) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  try {
    await findAndLinkFundingDraftByFundingId(resolvedFundingId);

    const result = await pool.query(
      `
      SELECT
        fp.funding_id,
        fp.brewery_user_id,
        fp.title,
        fp.description,
        fp.summary,
        COALESCE(NULLIF(fd.thumbnail_url, ''), NULLIF(fp.thumbnail_url, '')) AS thumbnail_url,
        COALESCE(NULLIF(fd.image_urls::text, '[]'), NULLIF(fp.image_urls::text, '[]')) AS image_urls,
        fd.introduction AS draft_introduction,
        fd.video_url,
        COALESCE(NULLIF(fd.main_ingredient, ''), NULLIF(r.main_ingredient, '')) AS main_ingredient,
        COALESCE(NULLIF(fd.sub_ingredients, ''), NULLIF(r.ai_sub_ingredient, '')) AS sub_ingredients,
        COALESCE(NULLIF(fd.budget_plan, ''), NULLIF(fp.budget_plan, '')) AS budget_plan,
        COALESCE(NULLIF(fd.schedule_plan, ''), NULLIF(fp.schedule_plan, '')) AS schedule_plan,
        COALESCE(NULLIF(fd.refund_policy, ''), NULLIF(fp.refund_policy, '')) AS refund_policy,
        COALESCE(NULLIF(fd.exchange_policy, ''), NULLIF(fp.exchange_policy, '')) AS exchange_policy,
        r.content AS recipe_content,
        r.concept,
        r.main_ingredient AS recipe_main_ingredient,
        r.ai_sub_ingredient AS recipe_sub_ingredient,
        COALESCE(NULLIF(bp.brewery_name, ''), ba.brewery_name, u.nickname) AS brewery_name,
        bp.brewery_name AS profile_brewery_name,
        ba.brewery_name AS auth_brewery_name,
        u.nickname AS brewery_nickname,
        bp.profile_image_url,
        bp.one_line_introduction,
        bp.short_introduction,
        bp.brand_story,
        bp.history,
        bp.established_year,
        ba.license_number AS business_registration_number,
        bp.representative_name,
        bp.address AS profile_address,
        ba.location AS auth_location,
        ba.business_address_detail AS auth_business_address_detail
      FROM funding_projects fp
      LEFT JOIN recipes r ON r.recipe_id = fp.recipe_id
      JOIN users u ON u.user_id = fp.brewery_user_id
      LEFT JOIN brewery_profiles bp ON bp.user_id = fp.brewery_user_id
      LEFT JOIN LATERAL (
        SELECT brewery_name, location, business_address_detail, license_number
        FROM brewery_auth
        WHERE user_id = fp.brewery_user_id
        ORDER BY
          CASE WHEN status = 'APPROVED' THEN 0 ELSE 1 END,
          updated_at DESC,
          application_id DESC
        LIMIT 1
      ) ba ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          thumbnail_url,
          image_urls,
          introduction,
          video_url,
          main_ingredient,
          sub_ingredients,
          budget_plan,
          schedule_plan,
          refund_policy,
          exchange_policy
        FROM funding_drafts fd_inner
        WHERE fd_inner.funding_id = fp.funding_id
        ORDER BY updated_at DESC
        LIMIT 1
      ) fd ON TRUE
      WHERE fp.funding_id = $1
      `,
      [resolvedFundingId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 프로젝트를 찾을 수 없습니다.',
      });
    }

    const funding = result.rows[0];
    const {
      mainIngredient,
      primaryIngredient,
      subIngredient,
      subIngredients,
      ingredients,
    } = buildFundingIngredientContext(funding);
    const imageFields = buildImageFields(funding.thumbnail_url, funding.image_urls);
    const budgetPlan = parseOriginalTextField(funding.budget_plan);
    const schedulePlan = parseOriginalTextField(funding.schedule_plan);
    const projectPolicy = selectProjectPolicyText(funding.refund_policy, funding.exchange_policy);
    const breweryProfile = buildPublicBreweryProfile(funding);

    return res.status(200).json({
      fundingId: Number(funding.funding_id),
      breweryUserId: breweryProfile.breweryUserId,
      breweryName: breweryProfile.breweryName,
      title: funding.title,
      introduction: funding.draft_introduction || funding.summary || funding.description || funding.recipe_content || '',
      story: funding.description || funding.recipe_content || funding.concept || '',
      mainIngredient,
      primaryIngredient,
      mainIngredientLabel: MAIN_INGREDIENT_LABEL,
      primaryIngredientLabel: MAIN_INGREDIENT_LABEL,
      subIngredient,
      subIngredients,
      ingredients,
      videoUrl: funding.video_url,
      budgetPlan,
      projectBudget: budgetPlan,
      schedulePlan,
      projectSchedule: schedulePlan,
      policy: projectPolicy,
      projectPolicy,
      ...PLAN_GUIDES,
      thumbnailUrl: imageFields.thumbnailUrl,
      imageUrls: imageFields.imageUrls,
      allImageUrls: imageFields.allImageUrls,
      images: mapFundingImageUrls(imageFields.allImageUrls),
      breweryInfo: breweryProfile,
      breweryProfile,
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '펀딩 상세 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 상세 처리 로직
const getBreweryLogs = async (req, res) => {
  const { fundingId } = req.params;
  const userId = getUserId(req);
  const resolvedFundingId = await resolveFundingId(fundingId);

  if (!resolvedFundingId) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  try {
    const breweryLogColumns = await getBreweryLogOptionalColumns();
    const videoUrlSelect = breweryLogColumns.has('video_url')
      ? 'bl.video_url'
      : 'NULL::text AS video_url';
    const updatedAtSelect = breweryLogColumns.has('updated_at')
      ? 'bl.updated_at'
      : 'bl.created_at AS updated_at';

    const result = await pool.query(
      `
      SELECT
        bl.log_id,
        bl.funding_id,
        bl.step,
        bl.title,
        bl.content,
        ${videoUrlSelect},
        bl.image_urls,
        bl.created_at,
        ${updatedAtSelect},
        COALESCE(lc.like_count, 0) AS like_count,
        EXISTS (
          SELECT 1
          FROM brewery_log_likes bll
          WHERE bll.brewery_log_id = bl.log_id
          AND bll.user_id = $2
        ) AS liked,
        COALESCE(cc.comment_count, 0) AS comment_count
      FROM brewery_logs bl
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS like_count
        FROM brewery_log_likes
        WHERE brewery_log_id = bl.log_id
      ) lc ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS comment_count
        FROM brewery_log_comments
        WHERE brewery_log_id = bl.log_id
        AND parent_comment_id IS NULL
      ) cc ON TRUE
      WHERE bl.funding_id = $1
      ORDER BY bl.step ASC, bl.created_at DESC
      `,
      [resolvedFundingId, userId]
    );

    return res.status(200).json({
      fundingId: resolvedFundingId,
      logs: result.rows.map((log) => mapBreweryLogResponse(log)),
      message: '요청 처리가 완료되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '요청 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 펀딩 처리 로직
const createBreweryLog = async (req, res) => {
  const { fundingId } = req.params;
  const { stage, title, content } = req.body;
  const requestedImageUrls = getBodyValue(req.body, ['imageUrls', 'image_urls']);
  const files = req.files || [];
  const userId = requireUserId(req, res);
  if (!userId) return;
  const resolvedFundingId = await resolveFundingId(fundingId);

  const allowedStages = [
    'INGREDIENT',
    'PROCESSING',
    'FERMENTATION',
    'FILTERING',
    'BOTTLING'
  ];

  if (!resolvedFundingId) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  if (!stage || !title || !content) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (!allowedStages.includes(stage)) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    const breweryLogColumns = await getBreweryLogOptionalColumns();
    const hasVideoUrl = hasBreweryLogVideoUrlField(req.body);
    const videoUrl = hasVideoUrl ? getBreweryLogVideoUrlFromBody(req.body) : null;

    if (videoUrl && !breweryLogColumns.has('video_url')) {
      return res.status(500).json({
        status: 500,
        message: '요청 처리 중 오류가 발생했습니다.',
        migration: 'database/20260530_brewery_log_video_url.sql',
      });
    }

    const uploadedImageUrls = [];
    for (const file of files) {
      uploadedImageUrls.push(await storeUploadedFile(file, `brewery-logs/${resolvedFundingId}`, userId));
    }

    const bodyImageUrls = mapBreweryLogImageUrls(requestedImageUrls);
    const normalizedImageUrls = uniqueValues([...bodyImageUrls, ...uploadedImageUrls]);

    if (normalizedImageUrls.length > 5) {
      return res.status(400).json({
        status: 400,
        message: '요청 값이 올바르지 않습니다.',
      });
    }

    const insertColumns = [
      'funding_id',
      'step',
      'title',
      'content',
      'image_urls',
    ];
    const insertValues = [
      resolvedFundingId,
      stage,
      title,
      content,
      JSON.stringify(normalizedImageUrls),
    ];

    if (breweryLogColumns.has('video_url')) {
      insertColumns.push('video_url');
      insertValues.push(videoUrl);
    }

    const returningColumns = [
      'log_id',
      'funding_id',
      'step',
      'title',
      'content',
      breweryLogColumns.has('video_url') ? 'video_url' : 'NULL::text AS video_url',
      'image_urls',
      'created_at',
      breweryLogColumns.has('updated_at') ? 'updated_at' : 'created_at AS updated_at',
    ];

    const result = await pool.query(
      `
      INSERT INTO brewery_logs (
        ${insertColumns.join(', ')}
      )
      VALUES (${insertValues.map((_, index) => `$${index + 1}`).join(', ')})
      RETURNING
        ${returningColumns.join(',\n        ')}
      `,
      insertValues
    );

    const log = result.rows[0];

    return res.status(201).json({
      ...mapBreweryLogResponse(log),
      likeCount: 0,
      liked: false,
      commentCount: 0,
      message: '요청 처리가 완료되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '요청 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 펀딩 처리 로직
const updateBreweryLog = async (req, res) => {
  const { fundingId, breweryLogId } = req.params;
  const { stage, title, content } = req.body;
  const requestedImageUrls = getBodyValue(req.body, ['imageUrls', 'image_urls']);
  const requestedDeleteImageUrls = getBodyValue(req.body, ['deleteImageUrls', 'delete_image_urls']);
  const files = req.files || [];
  const userId = requireUserId(req, res);
  if (!userId) return;

  const allowedStages = [
    'INGREDIENT',
    'PROCESSING',
    'FERMENTATION',
    'FILTERING',
    'BOTTLING'
  ];

  if (
    !fundingId ||
    isNaN(Number(fundingId)) ||
    !breweryLogId ||
    isNaN(Number(breweryLogId))
  ) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  const hasImageUrls = hasOwn(req.body, 'imageUrls') || hasOwn(req.body, 'image_urls');
  const hasDeleteImageUrls =
    hasOwn(req.body, 'deleteImageUrls') || hasOwn(req.body, 'delete_image_urls');
  const hasVideoUrl = hasBreweryLogVideoUrlField(req.body);

  if (
    !stage &&
    !title &&
    !content &&
    !hasImageUrls &&
    !hasDeleteImageUrls &&
    !hasVideoUrl &&
    files.length === 0
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (stage && !allowedStages.includes(stage)) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    const resolvedFundingId = await resolveFundingId(fundingId);
    const breweryLogColumns = await getBreweryLogOptionalColumns();
    const videoUrl = getBreweryLogVideoUrlFromBody(req.body);

    if (videoUrl && !breweryLogColumns.has('video_url')) {
      return res.status(500).json({
        status: 500,
        message: '요청 처리 중 오류가 발생했습니다.',
        migration: 'database/20260530_brewery_log_video_url.sql',
      });
    }

    if (!resolvedFundingId) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 프로젝트를 찾을 수 없습니다.',
      });
    }

    const currentSelect = [
      'log_id',
      'funding_id',
      'step',
      'title',
      'content',
      'image_urls',
      breweryLogColumns.has('video_url') ? 'video_url' : 'NULL::text AS video_url',
      'created_at',
      breweryLogColumns.has('updated_at') ? 'updated_at' : 'created_at AS updated_at',
    ];
    const currentResult = await pool.query(
      `
      SELECT ${currentSelect.join(', ')}
      FROM brewery_logs
      WHERE funding_id = $1
        AND log_id = $2
      `,
      [resolvedFundingId, Number(breweryLogId)]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 프로젝트를 찾을 수 없습니다.',
      });
    }

    const uploadedImageUrls = [];
    for (const file of files) {
      uploadedImageUrls.push(await storeUploadedFile(file, `brewery-logs/${resolvedFundingId}`, userId));
    }

    let normalizedImageUrls = null;
    if (hasImageUrls || hasDeleteImageUrls || uploadedImageUrls.length > 0) {
      const currentImageUrls = mapBreweryLogImageUrls(currentResult.rows[0].image_urls);
      const baseImageUrls = hasImageUrls
        ? mapBreweryLogImageUrls(requestedImageUrls)
        : currentImageUrls;
      const deleteImageUrlSet = new Set(
        mapBreweryLogImageUrls(requestedDeleteImageUrls)
      );
      normalizedImageUrls = uniqueValues(
        [...baseImageUrls, ...uploadedImageUrls].filter((imageUrl) => !deleteImageUrlSet.has(imageUrl))
      );
    }

    if (normalizedImageUrls && normalizedImageUrls.length > 5) {
      return res.status(400).json({
        status: 400,
        message: '요청 값이 올바르지 않습니다.',
      });
    }

    const setClauses = [];
    const values = [];
    const addSet = (column, value) => {
      values.push(value);
      setClauses.push(`${column} = $${values.length}`);
    };

    if (stage) addSet('step', stage);
    if (title) addSet('title', title);
    if (content) addSet('content', content);
    if (normalizedImageUrls) addSet('image_urls', JSON.stringify(normalizedImageUrls));
    if (hasVideoUrl && breweryLogColumns.has('video_url')) {
      addSet('video_url', videoUrl);
    }
    if (breweryLogColumns.has('updated_at')) {
      setClauses.push('updated_at = CURRENT_TIMESTAMP');
    }

    if (setClauses.length === 0) {
      return res.status(200).json({
        ...mapBreweryLogResponse(currentResult.rows[0]),
        message: '요청 처리가 완료되었습니다.',
      });
    }

    values.push(resolvedFundingId);
    const fundingIdParam = `$${values.length}`;
    values.push(Number(breweryLogId));
    const logIdParam = `$${values.length}`;

    const returningColumns = [
      'log_id',
      'funding_id',
      'step',
      'title',
      'content',
      breweryLogColumns.has('video_url') ? 'video_url' : 'NULL::text AS video_url',
      'image_urls',
      'created_at',
      breweryLogColumns.has('updated_at') ? 'updated_at' : 'created_at AS updated_at',
    ];

    const result = await pool.query(
      `
      UPDATE brewery_logs
      SET
        ${setClauses.join(',\n        ')}
      WHERE funding_id = ${fundingIdParam}
      AND log_id = ${logIdParam}
      RETURNING
        ${returningColumns.join(',\n        ')}
      `,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 프로젝트를 찾을 수 없습니다.',
      });
    }

    const log = result.rows[0];

    return res.status(200).json({
      ...mapBreweryLogResponse(log),
      message: '요청 처리가 완료되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '요청 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 펀딩 처리 로직
const deleteBreweryLog = async (req, res) => {
  const { fundingId, breweryLogId } = req.params;

  if (
    !fundingId ||
    isNaN(Number(fundingId)) ||
    !breweryLogId ||
    isNaN(Number(breweryLogId))
  ) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  try {
    await pool.query(
      `
      DELETE FROM brewery_log_comment_likes
      WHERE comment_id IN (
        SELECT comment_id
        FROM brewery_log_comments
        WHERE brewery_log_id = $1
      )
      `,
      [Number(breweryLogId)]
    );

    await pool.query(
      `
      DELETE FROM brewery_log_comments
      WHERE brewery_log_id = $1
      `,
      [Number(breweryLogId)]
    );

    await pool.query(
      `
      DELETE FROM brewery_log_likes
      WHERE brewery_log_id = $1
      `,
      [Number(breweryLogId)]
    );

    const result = await pool.query(
      `
      DELETE FROM brewery_logs
      WHERE funding_id = $1
      AND log_id = $2
      RETURNING log_id, funding_id
      `,
      [Number(fundingId), Number(breweryLogId)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 프로젝트를 찾을 수 없습니다.',
      });
    }

    return res.status(200).json({
      breweryLogId: Number(result.rows[0].log_id),
      fundingId: Number(result.rows[0].funding_id),
      message: '요청 처리가 완료되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '요청 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 펀딩 처리 로직
const getFundingQuestions = async (req, res) => {
  const { fundingId } = req.params;
  const { page = 0, size = 10, answered } = req.query;
  const userId = getUserId(req);

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: 'Q&A를 찾을 수 없습니다.',
    });
  }

  const pageNumber = Number(page);
  const sizeNumber = Number(size);

  if (
    !Number.isInteger(pageNumber) ||
    !Number.isInteger(sizeNumber) ||
    pageNumber < 0 ||
    sizeNumber <= 0
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (answered !== undefined && answered !== 'true' && answered !== 'false') {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    const values = [Number(fundingId)];
    const conditions = ['fq.funding_id = $1'];

    if (answered !== undefined) {
      values.push(answered === 'true');
      conditions.push(`fq.answered = $${values.length}`);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS total_count
      FROM funding_questions fq
      ${whereClause}
      `,
      values
    );

    const queryValues = [
      ...values,
      userId,
      sizeNumber,
      pageNumber * sizeNumber,
    ];
    const userIdParam = `$${values.length + 1}`;
    const limitParam = `$${values.length + 2}`;
    const offsetParam = `$${values.length + 3}`;

    const result = await pool.query(
      `
      SELECT
        fq.question_id,
        fq.funding_id,
        fq.user_id,
        u.nickname AS writer_nickname,
        u.profile_image AS writer_profile_image,
        u.role AS writer_role,
        fq.title,
        fq.content,
        fq.is_private,
        fq.answered,
        fq.created_at,
        COALESCE(ql.like_count, 0) AS like_count,
        EXISTS (
          SELECT 1
          FROM funding_question_likes my_like
          WHERE my_like.question_id = fq.question_id
          AND my_like.user_id = ${userIdParam}
        ) AS liked,
        COALESCE(
          json_agg(
            json_build_object(
              'replyId', fqr.reply_id,
              'writerId', fqr.user_id,
              'userId', fqr.user_id,
              'writer_id', fqr.user_id,
              'user_id', fqr.user_id,
              'writerNickname', reply_user.nickname,
              'writerProfileImage', reply_user.profile_image,
              'profileImage', reply_user.profile_image,
              'writerRole', COALESCE(reply_user.role, 'USER'),
              'role', COALESCE(reply_user.role, 'USER'),
              'isBrewery', COALESCE(reply_user.role, 'USER') LIKE 'BREWERY%',
              'writerIsBrewery', COALESCE(reply_user.role, 'USER') LIKE 'BREWERY%',
              'content', fqr.content,
              'likeCount', COALESCE(fqrl.like_count, 0),
              'liked', EXISTS (
                SELECT 1
                FROM funding_question_reply_likes my_reply_like
                WHERE my_reply_like.reply_id = fqr.reply_id
                AND my_reply_like.user_id = ${userIdParam}
              ),
              'createdAt', fqr.created_at
            )
            ORDER BY fqr.created_at ASC
          ) FILTER (WHERE fqr.reply_id IS NOT NULL),
          '[]'
        ) AS replies
      FROM funding_questions fq
      LEFT JOIN users u ON u.user_id = fq.user_id
      LEFT JOIN funding_question_replies fqr
        ON fqr.question_id = fq.question_id
      LEFT JOIN users reply_user ON reply_user.user_id = fqr.user_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS like_count
        FROM funding_question_reply_likes
        WHERE reply_id = fqr.reply_id
      ) fqrl ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS like_count
        FROM funding_question_likes
        WHERE question_id = fq.question_id
      ) ql ON TRUE
      ${whereClause}
      GROUP BY fq.question_id, u.nickname, u.profile_image, u.role, ql.like_count
      ORDER BY fq.created_at DESC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
      `,
      queryValues
    );

    const totalElements = countResult.rows[0].total_count;

    return res.status(200).json({
      content: result.rows.map((question) => {
        const writerRole = normalizeWriterRole(question.writer_role);
        const writerIsBrewery = isBreweryWriterRole(writerRole);
        const replies = Array.isArray(question.replies)
          ? question.replies
          : parseJsonField(question.replies, []);
        const writerId = question.user_id === null || question.user_id === undefined
          ? null
          : Number(question.user_id);

        return {
          questionId: Number(question.question_id),
          fundingId: Number(question.funding_id),
          writerId,
          writer_id: writerId,
          userId: writerId,
          user_id: writerId,
          writerNickname: question.writer_nickname || '익명',
          writerProfileImage: question.writer_profile_image || null,
          profileImage: question.writer_profile_image || null,
          writerRole,
          role: writerRole,
          isBrewery: writerIsBrewery,
          writerIsBrewery,
          title: question.title,
          content: question.content,
          isPrivate: question.is_private,
          answered: question.answered,
          likeCount: Number(question.like_count || 0),
          liked: question.liked,
          replies: replies.map((reply) => {
            const replyWriterRole = normalizeWriterRole(reply.writerRole || reply.role);
            const replyWriterIsBrewery = isBreweryWriterRole(replyWriterRole);
            const replyWriterId = reply.writerId ?? reply.userId ?? reply.writer_id ?? reply.user_id;

            return {
              ...reply,
              replyId: reply.replyId === null || reply.replyId === undefined
                ? reply.replyId
                : Number(reply.replyId),
              writerId: replyWriterId === null || replyWriterId === undefined
                ? null
                : Number(replyWriterId),
              writer_id: replyWriterId === null || replyWriterId === undefined
                ? null
                : Number(replyWriterId),
              userId: replyWriterId === null || replyWriterId === undefined
                ? null
                : Number(replyWriterId),
              user_id: replyWriterId === null || replyWriterId === undefined
                ? null
                : Number(replyWriterId),
              writerNickname: reply.writerNickname || '익명',
              writerProfileImage: reply.writerProfileImage || reply.profileImage || null,
              profileImage: reply.writerProfileImage || reply.profileImage || null,
              writerRole: replyWriterRole,
              role: replyWriterRole,
              isBrewery: replyWriterIsBrewery,
              writerIsBrewery: replyWriterIsBrewery,
              likeCount: Number(reply.likeCount || 0),
              liked: Boolean(reply.liked),
            };
          }),
          createdAt: question.created_at,
        };
      }),
      page: pageNumber,
      size: sizeNumber,
      totalElements,
      totalPages: Math.ceil(totalElements / sizeNumber),
      message: '요청 처리 중 오류가 발생했습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: 'Q&A 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// Q&A 처리 로직
const createFundingQuestion = async (req, res) => {
  const { fundingId } = req.params;
  const {
    title,
    content,
    isPrivate = false
  } = req.body || {};

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: 'Q&A를 찾을 수 없습니다.',
    });
  }

  if (!content || typeof content !== 'string' || content.trim() === '') {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const result = await pool.query(
      `
      WITH inserted AS (
        INSERT INTO funding_questions (
          funding_id,
          user_id,
          title,
          content,
          is_private
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      )
      SELECT
        inserted.*,
        u.nickname AS writer_nickname,
        u.profile_image AS writer_profile_image,
        u.role AS writer_role
      FROM inserted
      LEFT JOIN users u ON u.user_id = inserted.user_id
      `,
      [
        Number(fundingId),
        userId,
        title || null,
        content.trim(),
        Boolean(isPrivate)
      ]
    );

    const question = result.rows[0];
    const writerRole = normalizeWriterRole(question.writer_role);
    const writerIsBrewery = isBreweryWriterRole(writerRole);

    return res.status(201).json({
      questionId: Number(question.question_id),
      fundingId: Number(question.funding_id),
      writerId: Number(question.user_id),
      writer_id: Number(question.user_id),
      userId: Number(question.user_id),
      user_id: Number(question.user_id),
      writerNickname: question.writer_nickname || '익명',
      writerProfileImage: question.writer_profile_image || null,
      profileImage: question.writer_profile_image || null,
      writerRole,
      role: writerRole,
      isBrewery: writerIsBrewery,
      writerIsBrewery,
      title: question.title,
      content: question.content,
      isPrivate: question.is_private,
      answered: question.answered,
      createdAt: question.created_at,
      message: "요청 처리 중 오류가 발생했습니다."
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Q&A 처리 중 오류가 발생했습니다.',
    });
  }
};

// Q&A 처리 로직
const createFundingReply = async (req, res) => {
  const { fundingId, questionId } = req.params;
  const { content } = req.body;

  if (!fundingId || isNaN(Number(fundingId)) || !questionId || isNaN(Number(questionId))) {
    return res.status(404).json({ status: 404, message: '펀딩 프로젝트를 찾을 수 없습니다.' });
  }

  if (!content || typeof content !== 'string' || content.trim() === '') {
    return res.status(400).json({ status: 400, message: '펀딩 프로젝트를 찾을 수 없습니다.' });
  }

  try {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const replyResult = await pool.query(
      `
      WITH inserted AS (
        INSERT INTO funding_question_replies (
          question_id,
          funding_id,
          user_id,
          content
        )
        VALUES ($1, $2, $3, $4)
        RETURNING reply_id, question_id, funding_id, user_id, content, created_at
      )
      SELECT
        inserted.*,
        u.nickname AS writer_nickname,
        u.profile_image AS writer_profile_image,
        u.role AS writer_role
      FROM inserted
      LEFT JOIN users u ON u.user_id = inserted.user_id
      `,
      [Number(questionId), Number(fundingId), userId, content.trim()]
    );

    await pool.query(
      `
      UPDATE funding_questions
      SET answered = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE question_id = $1 AND funding_id = $2
      `,
      [Number(questionId), Number(fundingId)]
    );

    const reply = replyResult.rows[0];
    const writerRole = normalizeWriterRole(reply.writer_role);
    const writerIsBrewery = isBreweryWriterRole(writerRole);

    return res.status(201).json({
      fundingId: Number(reply.funding_id),
      questionId: Number(reply.question_id),
      writerId: Number(reply.user_id),
      writer_id: Number(reply.user_id),
      userId: Number(reply.user_id),
      user_id: Number(reply.user_id),
      replyId: Number(reply.reply_id),
      writerNickname: reply.writer_nickname || '익명',
      writerProfileImage: reply.writer_profile_image || null,
      profileImage: reply.writer_profile_image || null,
      writerRole,
      role: writerRole,
      isBrewery: writerIsBrewery,
      writerIsBrewery,
      content: reply.content,
      likeCount: 0,
      liked: false,
      createdAt: reply.created_at,
      message: '요청 처리 중 오류가 발생했습니다.',
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      status: 500,
      message: '요청 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const likeFundingQuestion = async (req, res) => {
  const { fundingId, questionId } = req.params;
  const userId = requireUserId(req, res);
  if (!userId) return;

  if (!fundingId || isNaN(Number(fundingId)) || !questionId || isNaN(Number(questionId))) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    const questionResult = await pool.query(
      `
      SELECT question_id
      FROM funding_questions
      WHERE funding_id = $1
      AND question_id = $2
      `,
      [Number(fundingId), Number(questionId)]
    );

    if (questionResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: 'Q&A를 찾을 수 없습니다.',
      });
    }

    await pool.query(
      `
      INSERT INTO funding_question_likes (
        question_id,
        user_id
      )
      VALUES ($1, $2)
      ON CONFLICT (question_id, user_id) DO NOTHING
      `,
      [Number(questionId), userId]
    );

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS like_count
      FROM funding_question_likes
      WHERE question_id = $1
      `,
      [Number(questionId)]
    );

    return res.status(201).json({
      fundingId: Number(fundingId),
      questionId: Number(questionId),
      liked: true,
      likeCount: countResult.rows[0].like_count,
      message: 'Q&A 처리가 완료되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: 'Q&A 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const unlikeFundingQuestion = async (req, res) => {
  const { fundingId, questionId } = req.params;
  const userId = requireUserId(req, res);
  if (!userId) return;

  if (!fundingId || isNaN(Number(fundingId)) || !questionId || isNaN(Number(questionId))) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    await pool.query(
      `
      DELETE FROM funding_question_likes
      WHERE question_id = $1
      AND user_id = $2
      `,
      [Number(questionId), userId]
    );

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS like_count
      FROM funding_question_likes
      WHERE question_id = $1
      `,
      [Number(questionId)]
    );

    return res.status(200).json({
      fundingId: Number(fundingId),
      questionId: Number(questionId),
      liked: false,
      likeCount: countResult.rows[0].like_count,
      message: 'Q&A 처리가 완료되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: 'Q&A 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const likeFundingQuestionReply = async (req, res) => {
  const { fundingId, questionId, replyId } = req.params;
  const userId = requireUserId(req, res);
  if (!userId) return;

  if (
    !fundingId ||
    isNaN(Number(fundingId)) ||
    !questionId ||
    isNaN(Number(questionId)) ||
    !replyId ||
    isNaN(Number(replyId))
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    const replyResult = await pool.query(
      `
      SELECT reply_id
      FROM funding_question_replies
      WHERE funding_id = $1
      AND question_id = $2
      AND reply_id = $3
      `,
      [Number(fundingId), Number(questionId), Number(replyId)]
    );

    if (replyResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: 'Q&A를 찾을 수 없습니다.',
      });
    }

    await pool.query(
      `
      INSERT INTO funding_question_reply_likes (
        reply_id,
        user_id
      )
      VALUES ($1, $2)
      ON CONFLICT (reply_id, user_id) DO NOTHING
      `,
      [Number(replyId), userId]
    );

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS like_count
      FROM funding_question_reply_likes
      WHERE reply_id = $1
      `,
      [Number(replyId)]
    );

    return res.status(201).json({
      fundingId: Number(fundingId),
      questionId: Number(questionId),
      replyId: Number(replyId),
      liked: true,
      likeCount: Number(countResult.rows[0].like_count || 0),
      message: 'Q&A 처리가 완료되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: 'Q&A 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const unlikeFundingQuestionReply = async (req, res) => {
  const { fundingId, questionId, replyId } = req.params;
  const userId = requireUserId(req, res);
  if (!userId) return;

  if (
    !fundingId ||
    isNaN(Number(fundingId)) ||
    !questionId ||
    isNaN(Number(questionId)) ||
    !replyId ||
    isNaN(Number(replyId))
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    await pool.query(
      `
      DELETE FROM funding_question_reply_likes
      WHERE reply_id = $1
      AND user_id = $2
      `,
      [Number(replyId), userId]
    );

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS like_count
      FROM funding_question_reply_likes
      WHERE reply_id = $1
      `,
      [Number(replyId)]
    );

    return res.status(200).json({
      fundingId: Number(fundingId),
      questionId: Number(questionId),
      replyId: Number(replyId),
      liked: false,
      likeCount: Number(countResult.rows[0].like_count || 0),
      message: 'Q&A 처리가 완료되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: 'Q&A 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// Q&A 처리 로직
const getFundingReviews = async (req, res) => {
  const { fundingId } = req.params;
  const { page = 0, size = 10, sort = 'LATEST' } = req.query;
  const userId = getUserId(req);
  const resolvedFundingId = await resolveFundingId(fundingId);

  if (!resolvedFundingId) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 후기를 찾을 수 없습니다.',
    });
  }

  const pageNumber = Number(page);
  const sizeNumber = Number(size);

  if (
    !Number.isInteger(pageNumber) ||
    !Number.isInteger(sizeNumber) ||
    pageNumber < 0 ||
    sizeNumber <= 0
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const allowedSorts = ['LATEST', 'RATING'];
  if (!allowedSorts.includes(sort)) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const orderBy =
    sort === 'RATING'
      ? 'ORDER BY fr.rating DESC, fr.created_at DESC'
      : 'ORDER BY fr.created_at DESC';

  try {
    const reviewWriteState = await getFundingReviewWriteState(resolvedFundingId, userId);
    const reviewWritable = reviewWriteState.canWriteReview;
    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS total_count
      FROM funding_reviews
      WHERE funding_id = $1
      `,
      [resolvedFundingId]
    );

    const result = await pool.query(
      `
      SELECT
        fr.review_id,
        fr.funding_id,
        fr.user_id,
        u.nickname AS writer_nickname,
        u.profile_image AS writer_profile_image,
        u.role AS writer_role,
        fr.rating,
        fr.title,
        fr.content,
        fr.image_urls,
        fr.mood,
        fr.pairing,
        fr.tags,
        fr.record_visibility,
        fr.created_at,
        fr.updated_at,
        COALESCE(like_counts.like_count, 0) AS like_count,
        (fr.user_id = fp.brewery_user_id) AS is_project_owner,
        EXISTS (
          SELECT 1
          FROM funding_review_likes my_like
          WHERE my_like.review_id = fr.review_id
          AND my_like.user_id = $4
        ) AS liked
      FROM funding_reviews fr
      LEFT JOIN funding_projects fp ON fp.funding_id = fr.funding_id
      LEFT JOIN users u ON u.user_id = fr.user_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS like_count
        FROM funding_review_likes frl
        WHERE frl.review_id = fr.review_id
      ) like_counts ON TRUE
      WHERE fr.funding_id = $1
      ${orderBy}
      LIMIT $2 OFFSET $3
      `,
      [resolvedFundingId, sizeNumber, pageNumber * sizeNumber, userId]
    );

    const totalElements = countResult.rows[0].total_count;

    return res.status(200).json({
      content: result.rows.map(mapFundingReview),
      page: pageNumber,
      size: sizeNumber,
      totalElements,
      totalPages: Math.ceil(totalElements / sizeNumber),
      canWriteReview: reviewWritable,
      canReview: reviewWritable,
      hasWrittenReview: Boolean(reviewWriteState.existingReview),
      myReviewId: reviewWriteState.existingReview
        ? Number(reviewWriteState.existingReview.review_id)
        : null,
      message: '요청 처리 중 오류가 발생했습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '펀딩 후기 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const getFundingReviewDetail = async (req, res) => {
  const { fundingId, reviewId } = req.params;
  const userId = getUserId(req);
  const resolvedFundingId = await resolveFundingId(fundingId);

  if (
    !resolvedFundingId ||
    !reviewId ||
    isNaN(Number(reviewId))
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        fr.review_id,
        fr.funding_id,
        fr.user_id,
        u.nickname AS writer_nickname,
        u.profile_image AS writer_profile_image,
        u.role AS writer_role,
        fr.rating,
        fr.title,
        fr.content,
        fr.image_urls,
        fr.mood,
        fr.pairing,
        fr.tags,
        fr.record_visibility,
        fr.created_at,
        fr.updated_at,
        COALESCE(like_counts.like_count, 0) AS like_count,
        (fr.user_id = fp.brewery_user_id) AS is_project_owner,
        EXISTS (
          SELECT 1
          FROM funding_review_likes my_like
          WHERE my_like.review_id = fr.review_id
          AND my_like.user_id = $3
        ) AS liked
      FROM funding_reviews fr
      LEFT JOIN funding_projects fp ON fp.funding_id = fr.funding_id
      LEFT JOIN users u ON u.user_id = fr.user_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS like_count
        FROM funding_review_likes frl
        WHERE frl.review_id = fr.review_id
      ) like_counts ON TRUE
      WHERE fr.funding_id = $1
      AND fr.review_id = $2
      `,
      [resolvedFundingId, Number(reviewId), userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 후기를 찾을 수 없습니다.',
      });
    }

    const reviewWriteState = await getFundingReviewWriteState(resolvedFundingId, userId);
    const reviewWritable = reviewWriteState.canWriteReview;

    return res.status(200).json({
      ...mapFundingReview(result.rows[0]),
      canWriteReview: reviewWritable,
      canReview: reviewWritable,
      hasWrittenReview: Boolean(reviewWriteState.existingReview),
      myReviewId: reviewWriteState.existingReview
        ? Number(reviewWriteState.existingReview.review_id)
        : null,
      message: '요청 처리 중 오류가 발생했습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '펀딩 후기 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const getFundingReviewById = async ({ fundingId, reviewId, userId }) => {
  const result = await pool.query(
    `
    SELECT
      fr.review_id,
      fr.funding_id,
      fr.user_id,
      u.nickname AS writer_nickname,
      u.profile_image AS writer_profile_image,
      u.role AS writer_role,
      fr.rating,
      fr.title,
      fr.content,
      fr.image_urls,
      fr.mood,
      fr.pairing,
      fr.tags,
      fr.record_visibility,
      fr.created_at,
      fr.updated_at,
      COALESCE(like_counts.like_count, 0) AS like_count,
      (fr.user_id = fp.brewery_user_id) AS is_project_owner,
      EXISTS (
        SELECT 1
        FROM funding_review_likes my_like
        WHERE my_like.review_id = fr.review_id
        AND my_like.user_id = $3
      ) AS liked
    FROM funding_reviews fr
    LEFT JOIN funding_projects fp ON fp.funding_id = fr.funding_id
    LEFT JOIN users u ON u.user_id = fr.user_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS like_count
      FROM funding_review_likes frl
      WHERE frl.review_id = fr.review_id
    ) like_counts ON TRUE
    WHERE fr.funding_id = $1
    AND fr.review_id = $2
    `,
    [Number(fundingId), Number(reviewId), userId]
  );

  return result.rows[0] || null;
};

const likeFundingReview = async (req, res) => {
  const { fundingId, reviewId } = req.params;
  const userId = requireUserId(req, res);
  if (!userId) return;
  const resolvedFundingId = await resolveFundingId(fundingId);

  if (!resolvedFundingId || !reviewId || isNaN(Number(reviewId))) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    const review = await getFundingReviewById({
      fundingId: resolvedFundingId,
      reviewId,
      userId,
    });

    if (!review) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 후기를 찾을 수 없습니다.',
      });
    }

    await pool.query(
      `
      INSERT INTO funding_review_likes (
        review_id,
        user_id
      )
      VALUES ($1, $2)
      ON CONFLICT (review_id, user_id) DO NOTHING
      `,
      [Number(reviewId), userId]
    );

    const likedReview = await getFundingReviewById({
      fundingId: resolvedFundingId,
      reviewId,
      userId,
    });

    return res.status(201).json({
      ...mapFundingReview(likedReview),
      liked: true,
      message: '펀딩 후기 처리가 완료되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '펀딩 후기 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const unlikeFundingReview = async (req, res) => {
  const { fundingId, reviewId } = req.params;
  const userId = requireUserId(req, res);
  if (!userId) return;
  const resolvedFundingId = await resolveFundingId(fundingId);

  if (!resolvedFundingId || !reviewId || isNaN(Number(reviewId))) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    const review = await getFundingReviewById({
      fundingId: resolvedFundingId,
      reviewId,
      userId,
    });

    if (!review) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 후기를 찾을 수 없습니다.',
      });
    }

    await pool.query(
      `
      DELETE FROM funding_review_likes
      WHERE review_id = $1
      AND user_id = $2
      `,
      [Number(reviewId), userId]
    );

    const unlikedReview = await getFundingReviewById({
      fundingId: resolvedFundingId,
      reviewId,
      userId,
    });

    return res.status(200).json({
      ...mapFundingReview(unlikedReview),
      liked: false,
      message: '펀딩 후기 처리가 완료되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '펀딩 후기 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 후기 처리 로직
const getSupportOptions = async (req, res) => {
  const { fundingId } = req.params;

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  try {
    const fundingResult = await pool.query(
      `
      SELECT
        fp.funding_id,
        fp.title,
        COALESCE(fp.summary, fp.description) AS summary,
        fp.description,
        fp.price_per_bottle,
        fd.total_quantity,
        COALESCE(fd.expected_delivery_date, fp.expected_delivery_date) AS expected_delivery_date,
        COALESCE(fd.volume, fp.volume) AS volume,
        COALESCE(fd.alcohol_percentage, fp.alcohol_percentage) AS alcohol_percentage,
        COALESCE(NULLIF(fd.main_ingredient, ''), NULLIF(r.main_ingredient, '')) AS main_ingredient,
        COALESCE(NULLIF(fd.sub_ingredients, ''), NULLIF(r.ai_sub_ingredient, '')) AS sub_ingredients
      FROM funding_projects fp
      LEFT JOIN recipes r ON r.recipe_id = fp.recipe_id
      LEFT JOIN LATERAL (
        SELECT
          expected_delivery_date,
          volume,
          alcohol_percentage,
          main_ingredient,
          sub_ingredients,
          total_quantity
        FROM funding_drafts fd_inner
        WHERE fd_inner.funding_id = fp.funding_id
        ORDER BY updated_at DESC
        LIMIT 1
      ) fd ON TRUE
      WHERE fp.funding_id = $1
      `,
      [Number(fundingId)]
    );

    if (fundingResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 프로젝트를 찾을 수 없습니다.',
      });
    }

    const funding = fundingResult.rows[0];
    const {
      mainIngredient,
      primaryIngredient,
      subIngredient,
      subIngredients,
      ingredients,
    } = buildFundingIngredientContext(funding);

    const result = await pool.query(
      `
      SELECT
        option_id,
        funding_id,
        name,
        price,
        description,
        volume,
        alcohol,
        stock,
        remaining_stock,
        max_per_user
      FROM funding_support_options
      WHERE funding_id = $1
      ORDER BY option_id ASC
      `,
      [Number(fundingId)]
    );

    return res.status(200).json({
      fundingId: Number(fundingId),
      expectedDeliveryDate: funding.expected_delivery_date,
      volume: funding.volume,
      alcoholPercentage: funding.alcohol_percentage,
      mainIngredient,
      primaryIngredient,
      mainIngredientLabel: MAIN_INGREDIENT_LABEL,
      primaryIngredientLabel: MAIN_INGREDIENT_LABEL,
      subIngredient,
      subIngredients,
      ingredients,
      supportOptions: buildFundingSupportOptionsResponse({
        options: result.rows,
        funding,
        mainIngredient,
        subIngredients,
        ingredients,
      }),
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '펀딩 후원 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 후원 처리 로직
const logFundingOrderValidationFailure = ({
  req,
  fundingId,
  optionId,
  quantity,
  recipientName,
  recipientPhone,
  shippingAddress,
  missingFields = [],
  invalidFields = [],
  reason,
}) => {
  console.warn('Funding order validation failed', {
    reason,
    fundingId: fundingId && !isNaN(Number(fundingId)) ? Number(fundingId) : null,
    userId: getUserId(req) || null,
    optionId: optionId === null || optionId === undefined || optionId === '' ? null : optionId,
    quantity,
    hasRecipientName: Boolean(recipientName),
    hasRecipientPhone: Boolean(recipientPhone),
    hasShippingAddress: Boolean(shippingAddress),
    missingFields,
    invalidFields,
  });
};

const FUNDING_ORDER_ENDED_MESSAGE = '종료된 펀딩에는 후원할 수 없습니다.';
const FUNDING_ORDER_NOT_STARTED_MESSAGE = '펀딩 시작 전에는 후원할 수 없습니다.';
const FUNDING_ORDER_INACTIVE_MESSAGE = 'ACTIVE 상태의 펀딩만 후원할 수 있습니다.';

const getFundingOrderAvailability = async (fundingId) => {
  const numericFundingId = Number(fundingId);

  if (!Number.isInteger(numericFundingId) || numericFundingId <= 0) {
    return { canCreate: true };
  }

  const { rows } = await pool.query(
    `
    SELECT
      funding_id,
      status,
      start_date::date > ((CURRENT_TIMESTAMP AT TIME ZONE $2)::date) AS is_not_started,
      end_date::date < ((CURRENT_TIMESTAMP AT TIME ZONE $2)::date) AS is_expired
    FROM funding_projects
    WHERE funding_id = $1
    LIMIT 1
    `,
    [numericFundingId, KST_TIMEZONE]
  );

  const funding = rows[0];

  if (!funding) {
    return { canCreate: true };
  }

  const fundingStatus = String(funding.status || '').trim().toUpperCase();

  if (fundingStatus !== 'ACTIVE') {
    return {
      canCreate: false,
      status: 400,
      message: FUNDING_ORDER_INACTIVE_MESSAGE,
    };
  }

  if (funding.is_not_started) {
    return {
      canCreate: false,
      status: 400,
      message: FUNDING_ORDER_NOT_STARTED_MESSAGE,
    };
  }

  if (funding.is_expired) {
    return {
      canCreate: false,
      status: 400,
      message: FUNDING_ORDER_ENDED_MESSAGE,
    };
  }

  return { canCreate: true };
};

const createFundingOrder = async (req, res) => {
  const { fundingId } = req.params;
  const numericFundingId = Number(fundingId);

  if (!Number.isInteger(numericFundingId) || numericFundingId <= 0) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  const userId = requireUserId(req, res);
  if (!userId) return;

  const fundingOrderAvailability = await getFundingOrderAvailability(req.params.fundingId);

  if (!fundingOrderAvailability.canCreate) {
    return res.status(fundingOrderAvailability.status).json({
      status: fundingOrderAvailability.status,
      message: fundingOrderAvailability.message,
    });
  }

  const body = req.body || {};

  const optionId = getBodyValue(body, ['supportOptionId', 'support_option_id', 'optionId', 'option_id']);
  const quantity = getBodyValue(body, ['quantity']);
  const donationAmount = getBodyValue(body, [
    'donationAmount',
    'donation_amount',
    'additionalSupportAmount',
    'additional_support_amount',
  ]) || 0;
  const recipientName = toTrimmedString(getBodyValue(body, ['recipientName', 'recipient_name']));
  const recipientPhone = toTrimmedString(getBodyValue(body, ['recipientPhone', 'recipient_phone']));
  const shippingAddress = toTrimmedString(
    getBodyValue(body, ['shippingAddress', 'shipping_address'])
  );
  const shippingDetailAddress = toTrimmedString(
    getBodyValue(body, ['shippingDetailAddress', 'shipping_detail_address'])
  );
  const supporterEmail = toTrimmedString(
    getBodyValue(body, ['supporterEmail', 'supporter_email'])
  );
  const supportMessage = toTrimmedString(
    getBodyValue(body, ['supportMessage', 'support_message', 'message'])
  );
  const successUrl = toTrimmedString(getBodyValue(body, ['successUrl', 'success_url']));
  const failUrl = toTrimmedString(getBodyValue(body, ['failUrl', 'fail_url']));
  const postalCode = toTrimmedString(
    getBodyValue(body, ['postalCode', 'postal_code', 'zonecode']) ||
      extractZonecodeFromAddress(shippingAddress)
  );
  const adultVerified = toRequiredBoolean(
    getBodyValue(body, ['adultVerified', 'adult_verified'])
  );
  const noticeAgreed = toRequiredBoolean(
    getBodyValue(body, ['noticeAgreed', 'notice_agreed'])
  );
  const privacyAgreed = toRequiredBoolean(
    getBodyValue(body, [
      'privacyAgreed',
      'privacy_agreed',
      'privacyThirdPartyAgreed',
      'privacy_third_party_agreed',
    ])
  );

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }



  const numericOptionId =
    optionId === null || optionId === undefined || optionId === ''
      ? null
      : Number(optionId);
  const bottleCount =
    quantity === null || quantity === undefined || quantity === ''
      ? 1
      : Number(quantity);
  const missingFields = [];
  const invalidFields = [];

  if (!recipientName) missingFields.push('recipientName');
  if (!recipientPhone) missingFields.push('recipientPhone');
  if (!shippingAddress) missingFields.push('shippingAddress');

  if (!Number.isInteger(bottleCount) || bottleCount <= 0) {
    invalidFields.push('quantity');
  }

  if (
    numericOptionId !== null &&
    (!Number.isInteger(numericOptionId) || numericOptionId <= 0)
  ) {
    invalidFields.push('optionId');
  }

  if (missingFields.length > 0 || invalidFields.length > 0) {
    logFundingOrderValidationFailure({
      req,
      fundingId,
      optionId,
      quantity,
      recipientName,
      recipientPhone,
      shippingAddress,
      missingFields,
      invalidFields,
      reason: 'invalid_order_input',
    });

    return res.status(400).json({
      status: 400,
      message: '주문 요청값이 올바르지 않습니다.',
      missingFields,
      invalidFields,
    });
  }

  if (!adultVerified) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (!noticeAgreed) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (!privacyAgreed) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const donationAmountNumber = Number(donationAmount || 0);

  if (!Number.isInteger(donationAmountNumber) || donationAmountNumber < 0) {
    logFundingOrderValidationFailure({
      req,
      fundingId,
      optionId,
      quantity,
      recipientName,
      recipientPhone,
      shippingAddress,
      invalidFields: ['additionalSupportAmount'],
      reason: 'invalid_additional_support_amount',
    });

    return res.status(400).json({
      status: 400,
      message: '추가 후원 금액이 올바르지 않습니다.',
      missingFields: [],
      invalidFields: ['additionalSupportAmount'],
    });
  }

  try {
    const fundingResult = await pool.query(
      `
      SELECT
        funding_id,
        title,
        price_per_bottle,
        shipping_fee,
        status,
        start_date,
        end_date
      FROM funding_projects
      WHERE funding_id = $1
      `,
      [Number(fundingId)]
    );

    if (fundingResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 프로젝트를 찾을 수 없습니다.',
      });
    }

    const funding = fundingResult.rows[0];
    const kstToday = await getKstToday();
    const fundingStatus = String(funding.status || '').trim().toUpperCase();

    if (fundingStatus !== 'ACTIVE') {
      return res.status(400).json({
        status: 400,
        message: FUNDING_ORDER_INACTIVE_MESSAGE,
      });
    }

    if (funding.start_date && String(funding.start_date).slice(0, 10) > String(kstToday).slice(0, 10)) {
      return res.status(400).json({
        status: 400,
        message: FUNDING_ORDER_NOT_STARTED_MESSAGE,
      });
    }

    if (funding.end_date && String(funding.end_date).slice(0, 10) < String(kstToday).slice(0, 10)) {
      return res.status(400).json({
        status: 400,
        message: FUNDING_ORDER_ENDED_MESSAGE,
      });
    }

    if (!isFundingSupportable(funding, kstToday)) {
      return res.status(400).json({
        status: 400,
        message: '종료된 펀딩에는 후원할 수 없습니다.',
      });
    }

    let supportOption = null;

    if (numericOptionId !== null) {
      const optionResult = await pool.query(
        `
        SELECT
          option_id,
          funding_id,
          name,
          price,
          remaining_stock,
          stock,
          COALESCE(remaining_stock, stock) AS available_stock,
          max_per_user
        FROM funding_support_options
        WHERE option_id = $1
          AND funding_id = $2
        `,
        [numericOptionId, Number(fundingId)]
      );

      if (optionResult.rows.length === 0) {
        return res.status(404).json({
          status: 404,
          message: '후원 옵션을 찾을 수 없습니다.',
        });
      }

      if (optionResult.rows.length === 0) {
        return res.status(404).json({
          status: 404,
          message: '펀딩 프로젝트를 찾을 수 없습니다.',
        });
      }

      supportOption = optionResult.rows[0];

      const availableStock = supportOption.available_stock === null || supportOption.available_stock === undefined
        ? null
        : Number(supportOption.available_stock);

      if (availableStock !== null && availableStock < bottleCount) {
        return res.status(400).json({
          status: 400,
          message: '후원 옵션 재고가 부족합니다.',
        });
      }

      const maxPerUser = supportOption.max_per_user === null || supportOption.max_per_user === undefined
        ? null
        : Number(supportOption.max_per_user);

      if (Number.isInteger(maxPerUser) && maxPerUser > 0) {
        const orderedQuantityResult = await pool.query(
          `
          SELECT COALESCE(SUM(quantity), 0)::int AS ordered_quantity
          FROM orders
          WHERE user_id = $1
            AND funding_id = $2
            AND option_id = $3
            AND order_status IN ('CREATED', 'PAID')
          `,
          [userId, Number(fundingId), numericOptionId]
        );

        const orderedQuantity = Number(orderedQuantityResult.rows[0]?.ordered_quantity || 0);

        if (orderedQuantity + bottleCount > maxPerUser) {
          return res.status(400).json({
            status: 400,
            message: '1인 최대 구매 수량을 초과했습니다.',
          });
        }
      }
    }

    const pricePerBottle = Number(
      supportOption?.price ?? funding.price_per_bottle
    );

    if (!Number.isFinite(pricePerBottle) || pricePerBottle <= 0) {
      return res.status(400).json({
        status: 400,
        message: '요청 값이 올바르지 않습니다.',
      });
    }

    const shippingFee =
      funding.shipping_fee !== null && funding.shipping_fee !== undefined
        ? Number(funding.shipping_fee)
        : 3000;
    const totalAmount =
      pricePerBottle * bottleCount + shippingFee + donationAmountNumber;

    const userResult = await pool.query(
      `
      SELECT user_id, nickname, email, phone_number
      FROM users
      WHERE user_id = $1
      `,
      [userId]
    );
    const user = userResult.rows[0] || {};

    const orderResult = await pool.query(
      `
      INSERT INTO orders (
        user_id,
        funding_id,
        option_id,
        quantity,
        price_per_bottle,
        shipping_fee,
        donation_amount,
        total_amount,
        order_status,
        recipient_name,
        recipient_phone,
        shipping_address,
        shipping_detail_address,
        supporter_email,
        support_message,
        postal_code,
        adult_verified,
        notice_agreed,
        privacy_agreed
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        'CREATED',
        $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
      )
      RETURNING
        order_id,
        funding_id,
        option_id,
        quantity,
        price_per_bottle,
        shipping_fee,
        donation_amount,
        total_amount,
        order_status,
        recipient_name,
        recipient_phone,
        shipping_address,
        shipping_detail_address,
        supporter_email,
        support_message,
        postal_code,
        adult_verified,
        notice_agreed,
        privacy_agreed,
        created_at
      `,
      [
        userId,
        Number(fundingId),
        numericOptionId,
        bottleCount,
        pricePerBottle,
        shippingFee,
        donationAmountNumber,
        totalAmount,
        recipientName,
        recipientPhone,
        shippingAddress,
        shippingDetailAddress || null,
        supporterEmail || null,
        supportMessage || null,
        postalCode || null,
        Boolean(adultVerified),
        Boolean(noticeAgreed),
        Boolean(privacyAgreed),
      ]
    );

    const order = orderResult.rows[0];
    const tossOrderId = `funding_order_${order.order_id}`;
    const paymentResult = await pool.query(
      `
      INSERT INTO payments (
        order_id,
        payment_method,
        payment_provider,
        amount,
        payment_status,
        toss_order_id
      )
      VALUES ($1, NULL, 'TOSS', $2, 'READY', $3)
      RETURNING payment_id, payment_status, amount, toss_order_id, created_at
      `,
      [Number(order.order_id), Number(order.total_amount), tossOrderId]
    );
    const payment = paymentResult.rows[0];
    const orderName = `${funding.title || '펀딩 후원'} ${bottleCount}병`;
    const customerName = user.nickname || recipientName;
    const customerEmail = user.email || supporterEmail || null;
    const customerMobilePhone = user.phone_number || recipientPhone;
    const responseData = {
      orderId: String(order.order_id),
      tossOrderId: payment.toss_order_id || tossOrderId,
      numericOrderId: Number(order.order_id),
      fundingId: String(order.funding_id),
      numericFundingId: Number(order.funding_id),
      optionId: order.option_id,
      supportOptionId: order.option_id,
      quantity: order.quantity,
      pricePerBottle: order.price_per_bottle,
      supportOptionPrice: order.price_per_bottle,
      shippingFee: order.shipping_fee,
      donationAmount: order.donation_amount,
      additionalSupportAmount: order.donation_amount,
      amount: order.total_amount,
      totalAmount: order.total_amount,
      orderName,
      customerName,
      customerEmail,
      customerMobilePhone,
      orderStatus: order.order_status,
      paymentId: payment.payment_id,
      paymentStatus: payment.payment_status,
      successUrl: successUrl || null,
      failUrl: failUrl || null,
      recipientName: order.recipient_name,
      recipientPhone: order.recipient_phone,
      shippingAddress: order.shipping_address,
      shippingDetailAddress: order.shipping_detail_address,
      supporterEmail: order.supporter_email,
      supportMessage: order.support_message,
      postalCode: order.postal_code,
      adultVerified: order.adult_verified,
      noticeAgreed: order.notice_agreed,
      privacyAgreed: order.privacy_agreed,
      createdAt: order.created_at,
    };

    return res.status(201).json({
      status: 201,
      data: responseData,
      orderId: order.order_id,
      tossOrderId: payment.toss_order_id || tossOrderId,
      fundingId: order.funding_id,
      optionId: order.option_id,
      supportOptionId: order.option_id,
      quantity: order.quantity,
      pricePerBottle: order.price_per_bottle,
      supportOptionPrice: order.price_per_bottle,
      shippingFee: order.shipping_fee,
      donationAmount: order.donation_amount,
      additionalSupportAmount: order.donation_amount,
      totalAmount: order.total_amount,
      orderStatus: order.order_status,
      paymentStatus: payment.payment_status,
      successUrl: successUrl || null,
      failUrl: failUrl || null,
      recipientName: order.recipient_name,
      recipientPhone: order.recipient_phone,
      shippingAddress: order.shipping_address,
      shippingDetailAddress: order.shipping_detail_address,
      supporterEmail: order.supporter_email,
      supportMessage: order.support_message,
      postalCode: order.postal_code,
      adultVerified: order.adult_verified,
      noticeAgreed: order.notice_agreed,
      createdAt: order.created_at,
      privacyAgreed: order.privacy_agreed,
      message: '펀딩 주문이 생성되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '펀딩 후원 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 후원 처리 로직
const createFundingInquiry = (req, res) => {
  const { fundingId } = req.params;
  const { title, content } = req.body;

  // 펀딩 후원 처리 로직
  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  // 펀딩 후원 처리 로직
  if (
    !title ||
    !content ||
    typeof title !== 'string' ||
    typeof content !== 'string' ||
    title.trim() === '' ||
    content.trim() === ''
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  return res.status(201).json({
    fundingId: Number(fundingId),
    inquiryId: 21,
    message: '펀딩 후원 처리가 완료되었습니다.',
  });
};


// 펀딩 후원 처리 로직
const getFundingShareLink = async (req, res) => {
  const { fundingId } = req.params;
  res.set('Content-Type', 'application/json; charset=utf-8');

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '\ud380\ub529 \ud504\ub85c\uc81d\ud2b8\ub97c \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.',
    });
  }

  try {
    const fundingResult = await pool.query(
      `SELECT funding_id, title, status
       FROM funding_projects
       WHERE funding_id = $1`,
      [Number(fundingId)]
    );

    if (fundingResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '\ud380\ub529 \ud504\ub85c\uc81d\ud2b8\ub97c \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.',
      });
    }

    const normalizeShareBaseUrl = (value) => {
      const normalized = typeof value === 'string' ? value.trim() : '';
      if (!normalized || normalized.toLowerCase() === 'null' || normalized.toLowerCase() === 'undefined') {
        return null;
      }
      return normalized.replace(/\/+$/, '');
    };

    const requestBaseUrl = normalizeShareBaseUrl(`${req.protocol}://${req.get('host')}`);
    const publicBaseUrl =
      normalizeShareBaseUrl(process.env.PUBLIC_WEB_BASE_URL) ||
      normalizeShareBaseUrl(process.env.FRONTEND_BASE_URL) ||
      requestBaseUrl;

    const shareUrl = `${publicBaseUrl}/funding/${Number(fundingId)}`;

    const shareResult = await pool.query(
      `INSERT INTO funding_shares (funding_id, share_url, share_count, created_at, updated_at)
       VALUES ($1, $2, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (funding_id)
       DO UPDATE SET
         share_url = EXCLUDED.share_url,
         share_count = funding_shares.share_count + 1,
         updated_at = CURRENT_TIMESTAMP
       RETURNING funding_id, share_url, share_count, created_at, updated_at`,
      [Number(fundingId), shareUrl]
    );

    const share = shareResult.rows[0];
    const responseData = {
      fundingId: share.funding_id,
      shareUrl: share.share_url,
      shareCount: Number(share.share_count || 0),
    };

    return res.status(200).json({
      status: 200,
      message: '\uacf5\uc720 \ub9c1\ud06c \uc0dd\uc131 \uc131\uacf5',
      data: responseData,
      fundingId: responseData.fundingId,
      shareUrl: responseData.shareUrl,
      shareCount: responseData.shareCount,
    });
  } catch (error) {
    console.error('funding share link error:', error);
    return res.status(500).json({
      status: 500,
      message: '\uacf5\uc720 \ub9c1\ud06c \uc0dd\uc131 \uc911 \uc11c\ubc84 \uc624\ub958\uac00 \ubc1c\uc0dd\ud588\uc2b5\ub2c8\ub2e4.',
      error: error.message,
    });
  }
};

const FUNDING_REPORT_TABLE_NAME = 'funding_reports';

const getFundingReportTableName = async () => FUNDING_REPORT_TABLE_NAME;

const FUNDING_REPORT_STATUSES = ['PENDING', 'REVIEWED', 'RESOLVED', 'REJECTED'];

const normalizeFundingReportStatus = (status) => String(status || '').trim().toUpperCase();

const createFundingReport = async (req, res) => {
  const { fundingId } = req.params;
  const { reason, content } = req.body || {};
  const resolvedFundingId = await resolveFundingId(fundingId);
  res.set('Content-Type', 'application/json; charset=utf-8');

  const reasonKey = typeof reason === 'string' ? reason.trim() : '';
  const reasonMap = {
    FALSE_INFORMATION: 'FALSE_INFORMATION',
    INAPPROPRIATE_CONTENT: 'INAPPROPRIATE_CONTENT',
    COPYRIGHT: 'COPYRIGHT',
    FRAUD: 'FRAUD',
    ETC: 'ETC',
    '\ud5c8\uc704 \uc815\ubcf4': 'FALSE_INFORMATION',
    '\ubd80\uc801\uc808\ud55c \ucf58\ud150\uce20': 'INAPPROPRIATE_CONTENT',
    '\uc800\uc791\uad8c \uce68\ud574': 'COPYRIGHT',
    '\uc0ac\uae30/\uae30\ub9cc': 'FRAUD',
    '\uae30\ud0c0': 'ETC',
  };
  const normalizedReason = reasonMap[reasonKey] || reasonMap[reasonKey.toUpperCase()];

  if (!resolvedFundingId) {
    return res.status(404).json({
      status: 404,
      message: '\ud380\ub529 \ud504\ub85c\uc81d\ud2b8\ub97c \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.',
    });
  }

  if (!normalizedReason) {
    return res.status(400).json({
      status: 400,
      message: '\uc2e0\uace0 \uc0ac\uc720\ub97c \uc120\ud0dd\ud574\uc8fc\uc138\uc694.',
    });
  }

  try {
    const reporterId = requireUserId(req, res);
    if (!reporterId) return;

    const reportTableName = await getFundingReportTableName();
    const result = await pool.query(
      `INSERT INTO ${reportTableName} (funding_id, reporter_id, reason, content, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING report_id, funding_id, reporter_id, reason, content, status, created_at, updated_at`,
      [resolvedFundingId, reporterId, normalizedReason, content || null]
    );

    const report = result.rows[0];
    return res.status(201).json({
      status: 201,
      reportId: report.report_id,
      fundingId: report.funding_id,
      reporterId: report.reporter_id,
      reason: report.reason,
      content: report.content,
      reportStatus: report.status,
      createdAt: report.created_at,
      message: '\uac80\ud1a0 \ud6c4 \ud544\uc694\ud55c \uc870\uce58\ub97c \uc9c4\ud589\ud558\uaca0\uc2b5\ub2c8\ub2e4.',
    });
  } catch (error) {
    console.error('funding report create error:', error);
    return res.status(500).json({
      status: 500,
      message: '\uc2e0\uace0 \ucc98\ub9ac \uc911 \uc11c\ubc84 \uc624\ub958\uac00 \ubc1c\uc0dd\ud588\uc2b5\ub2c8\ub2e4.',
      error: error.message,
    });
  }
};

const getFundingReports = async (req, res) => {
  const { status, page = 0, size = 10 } = req.query;

  const allowedStatuses = ['PENDING', 'REVIEWING', 'RESOLVED', 'REJECTED'];

  if (status && !allowedStatuses.includes(status)) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (isNaN(Number(page)) || isNaN(Number(size))) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const pageNumber = Number(page);
  const sizeNumber = Number(size);

  try {
    const values = [];
    const conditions = [];

    if (status) {
      values.push(status);
      conditions.push(`fr.status = $${values.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS total_count
      FROM ${reportTableName} fr
      ${whereClause}
      `,
      values
    );

    const listValues = [...values, sizeNumber, pageNumber * sizeNumber];

    const result = await pool.query(
      `
      SELECT
        fr.report_id,
        fr.funding_id,
        fp.title AS funding_title,
        fr.reporter_id,
        u.nickname AS reporter_nickname,
        fr.reason,
        fr.content,
        fr.status,
        fr.created_at
      FROM ${reportTableName} fr
      LEFT JOIN funding_projects fp ON fp.funding_id = fr.funding_id
      LEFT JOIN users u ON u.user_id = fr.reporter_id
      ${whereClause}
      ORDER BY fr.created_at DESC
      LIMIT $${listValues.length - 1}
      OFFSET $${listValues.length}
      `,
      listValues
    );

    const totalElements = countResult.rows[0].total_count;

    return res.status(200).json({
      content: result.rows.map((report) => ({
        reportId: Number(report.report_id),
        fundingId: Number(report.funding_id),
        fundingTitle: report.funding_title,
        reporterId: report.reporter_id,
        reporterNickname: report.reporter_nickname,
        reason: report.reason,
        content: report.content,
        status: report.status,
        createdAt: report.created_at,
      })),
      page: pageNumber,
      size: sizeNumber,
      totalElements,
      totalPages: Math.ceil(totalElements / sizeNumber),
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '신고 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 신고 처리 로직
// 신고 처리 로직
const createFundingReview = async (req, res) => {
  const { fundingId } = req.params;
  const {
    rating,
    title,
    content,
    detailReview,
    mood,
    pairing,
    tags,
    recordVisibility = true,
    showRecord,
    imageUrls,
  } = req.body || {};
  const files = req.files || [];

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 후기를 찾을 수 없습니다.',
    });
  }

  let normalizedRating;

  try {
    normalizedRating = normalizeReviewRatingInput(rating, { required: true });
  } catch (error) {
    return res.status(400).json({
      status: 400,
      message: error.message,
    });
  }

  const normalizedContent = toTrimmedString(content || detailReview);

  if (!normalizedContent) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const paidOrder = await findPaidFundingOrder(Number(fundingId), userId);

    if (!paidOrder) {
      return res.status(403).json({
        status: 403,
        message: '접근 권한이 없습니다.',
      });
    }

    const existingReview = await findFundingReviewByUser(Number(fundingId), userId);
    if (existingReview) {
      return res.status(409).json({
        status: 409,
        message: '이미 처리된 요청입니다.',
        data: {
          reviewId: Number(existingReview.review_id),
        },
      });
    }

    const uploadedImageUrls = [];
    for (const file of files) {
      uploadedImageUrls.push(await storeUploadedFile(file, `funding-reviews/${fundingId}`, userId));
    }

    const normalizedImageUrls = [
      ...parseJsonArrayField(imageUrls),
      ...uploadedImageUrls,
    ];
    const normalizedTags = parseJsonArrayField(tags);
    const normalizedRecordVisibility =
      parseOptionalBoolean(showRecord) ??
      parseOptionalBoolean(recordVisibility) ??
      true;

    const result = await pool.query(
      `
      INSERT INTO funding_reviews (
        funding_id,
        user_id,
        rating,
        title,
        content,
        image_urls,
        mood,
        pairing,
        tags,
        record_visibility
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING
        review_id,
        funding_id,
        user_id,
        rating,
        title,
        content,
        image_urls,
        mood,
        pairing,
        tags,
        record_visibility,
        created_at,
        updated_at
      `,
      [
        Number(fundingId),
        userId,
        normalizedRating,
        title || null,
        normalizedContent,
        JSON.stringify(normalizedImageUrls),
        mood || null,
        pairing || null,
        JSON.stringify(normalizedTags),
        normalizedRecordVisibility,
      ]
    );

    const createdReview = result.rows[0];

    if (!createdReview) {
      return res.status(500).json({
        status: 500,
        message: '펀딩 후기 처리 중 오류가 발생했습니다.',
      });
    }

    let review = createdReview;
    try {
      review = await getFundingReviewById({
        fundingId: Number(fundingId),
        reviewId: createdReview.review_id,
        userId,
      }) || createdReview;
    } catch (lookupError) {
      console.warn('Funding review lookup failed after create', {
        fundingId: Number(fundingId),
        reviewId: Number(createdReview.review_id),
        userId,
        message: lookupError.message,
      });
    }

    let aiTasteUpdate = null;
    try {
      aiTasteUpdate = await updateFundingReviewAiTasteProfile({
        userId,
        review,
        requestBody: req.body || {},
        isCreate: true,
      });
    } catch (aiError) {
      console.warn('Funding review AI taste update failed after review create', {
        fundingId: Number(fundingId),
        reviewId: Number(createdReview.review_id),
        userId,
        message: aiError.message,
      });
      aiTasteUpdate = {
        updated: false,
        message: '요청 처리 중 오류가 발생했습니다.',
      };
    }

    return res.status(201).json({
      ...mapFundingReview(review),
      ...(aiTasteUpdate ? { aiTasteUpdate } : {}),
      message: '펀딩 후기 처리가 완료되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '펀딩 후기 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const updateFundingReview = async (req, res) => {
  const { fundingId, reviewId } = req.params;
  const {
    rating,
    title,
    content,
    detailReview,
    mood,
    pairing,
    tags,
    recordVisibility,
    showRecord,
    imageUrls,
    deleteImageUrls,
  } = req.body || {};
  const files = req.files || [];

  if (
    !fundingId ||
    isNaN(Number(fundingId)) ||
    !reviewId ||
    isNaN(Number(reviewId))
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const normalizedRating = normalizeReviewRatingInput(rating);
    const existingResult = await pool.query(
      `
      SELECT *
      FROM funding_reviews
      WHERE funding_id = $1
      AND review_id = $2
      AND user_id = $3
      `,
      [Number(fundingId), Number(reviewId), userId]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 후기를 찾을 수 없습니다.',
      });
    }

    const current = existingResult.rows[0];
    const uploadedImageUrls = [];
    for (const file of files) {
      uploadedImageUrls.push(await storeUploadedFile(file, `funding-reviews/${fundingId}`, userId));
    }

    const deleteImageUrlSet = new Set(parseJsonArrayField(deleteImageUrls));
    const currentImageUrls = parseJsonArrayField(current.image_urls);
    const baseImageUrls = imageUrls !== undefined
      ? parseJsonArrayField(imageUrls)
      : currentImageUrls;
    const nextImageUrls = uniqueValues([
      ...baseImageUrls.filter((imageUrl) => !deleteImageUrlSet.has(imageUrl)),
      ...uploadedImageUrls,
    ]);
    const nextContent = toTrimmedString(content || detailReview) || current.content;
    const nextRecordVisibility =
      parseOptionalBoolean(showRecord) ??
      parseOptionalBoolean(recordVisibility) ??
      current.record_visibility;

    const result = await pool.query(
      `
      UPDATE funding_reviews
      SET
        rating = COALESCE($1::numeric, rating),
        title = COALESCE($2, title),
        content = $3,
        image_urls = $4,
        mood = COALESCE($5, mood),
        pairing = COALESCE($6, pairing),
        tags = COALESCE($7, tags),
        record_visibility = $8,
        updated_at = CURRENT_TIMESTAMP
      WHERE review_id = $9
      RETURNING
        review_id,
        funding_id,
        user_id,
        rating,
        title,
        content,
        image_urls,
        mood,
        pairing,
        tags,
        record_visibility,
        created_at,
        updated_at
      `,
      [
        normalizedRating,
        title || null,
        nextContent,
        JSON.stringify(nextImageUrls),
        mood || null,
        pairing || null,
        tags !== undefined ? JSON.stringify(parseJsonArrayField(tags)) : null,
        nextRecordVisibility,
        Number(reviewId),
      ]
    );

    const updatedReview = result.rows[0];

    if (!updatedReview) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 후기를 찾을 수 없습니다.',
      });
    }

    let review = updatedReview;
    try {
      review = await getFundingReviewById({
        fundingId: Number(fundingId),
        reviewId: updatedReview.review_id,
        userId,
      }) || updatedReview;
    } catch (lookupError) {
      console.warn('Funding review lookup failed after update', {
        fundingId: Number(fundingId),
        reviewId: Number(updatedReview.review_id),
        userId,
        message: lookupError.message,
      });
    }

    let aiTasteUpdate = null;
    try {
      aiTasteUpdate = await updateFundingReviewAiTasteProfile({
        userId,
        review,
        requestBody: req.body || {},
        isCreate: false,
      });
    } catch (aiError) {
      console.warn('Funding review AI taste update failed after review update', {
        fundingId: Number(fundingId),
        reviewId: Number(updatedReview.review_id),
        userId,
        message: aiError.message,
      });
      aiTasteUpdate = {
        updated: false,
        message: '요청 처리 중 오류가 발생했습니다.',
      };
    }

    return res.status(200).json({
      ...mapFundingReview(review),
      ...(aiTasteUpdate ? { aiTasteUpdate } : {}),
      message: '펀딩 후기 처리가 완료되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '펀딩 후기 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const deleteFundingReview = async (req, res) => {
  const { fundingId, reviewId } = req.params;

  if (
    !fundingId ||
    isNaN(Number(fundingId)) ||
    !reviewId ||
    isNaN(Number(reviewId))
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const result = await pool.query(
      `
      DELETE FROM funding_reviews
      WHERE funding_id = $1
      AND review_id = $2
      AND user_id = $3
      RETURNING review_id, funding_id, user_id
      `,
      [Number(fundingId), Number(reviewId), userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 후기를 찾을 수 없습니다.',
      });
    }

    const writerId = Number(result.rows[0].user_id);

    return res.status(200).json({
      reviewId: Number(result.rows[0].review_id),
      fundingId: Number(result.rows[0].funding_id),
      writerId,
      writer_id: writerId,
      userId: writerId,
      user_id: writerId,
      deleted: true,
      message: '요청 처리 중 오류가 발생했습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '펀딩 후기 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const getFundingReviewComments = async (req, res) => {
  const { fundingId, reviewId } = req.params;
  const userId = getUserId(req);
  const resolvedFundingId = await resolveFundingId(fundingId);

  if (
    !resolvedFundingId ||
    !reviewId ||
    isNaN(Number(reviewId))
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    const reviewResult = await pool.query(
      `
      SELECT review_id
      FROM funding_reviews
      WHERE funding_id = $1
      AND review_id = $2
      `,
      [resolvedFundingId, Number(reviewId)]
    );

    if (reviewResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: 'Q&A를 찾을 수 없습니다.',
      });
    }

    const result = await pool.query(
      `
      SELECT
        frc.comment_id,
        frc.funding_id,
        frc.review_id,
        frc.user_id,
        u.nickname AS writer_nickname,
        u.profile_image AS writer_profile_image,
        u.role AS writer_role,
        frc.content,
        frc.created_at,
        frc.updated_at,
        COALESCE(like_counts.like_count, 0) AS like_count,
        (frc.user_id = fp.brewery_user_id) AS is_project_owner,
        EXISTS (
          SELECT 1
          FROM funding_review_comment_likes my_like
          WHERE my_like.comment_id = frc.comment_id
          AND my_like.user_id = $3
        ) AS liked
      FROM funding_review_comments frc
      LEFT JOIN funding_projects fp ON fp.funding_id = frc.funding_id
      LEFT JOIN users u ON u.user_id = frc.user_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS like_count
        FROM funding_review_comment_likes frcl
        WHERE frcl.comment_id = frc.comment_id
      ) like_counts ON TRUE
      WHERE frc.funding_id = $1
      AND frc.review_id = $2
      ORDER BY frc.created_at ASC, frc.comment_id ASC
      `,
      [resolvedFundingId, Number(reviewId), userId]
    );

    return res.status(200).json({
      content: result.rows.map(mapFundingReviewComment),
      message: 'Q&A 처리가 완료되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: 'Q&A 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const createFundingReviewComment = async (req, res) => {
  const { fundingId, reviewId } = req.params;
  const content = toTrimmedString(req.body?.content);
  const userId = requireUserId(req, res);
  if (!userId) return;
  const resolvedFundingId = await resolveFundingId(fundingId);

  if (
    !resolvedFundingId ||
    !reviewId ||
    isNaN(Number(reviewId))
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  if (!content) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    const reviewResult = await pool.query(
      `
      SELECT review_id
      FROM funding_reviews
      WHERE funding_id = $1
      AND review_id = $2
      `,
      [resolvedFundingId, Number(reviewId)]
    );

    if (reviewResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: 'Q&A를 찾을 수 없습니다.',
      });
    }

    const result = await pool.query(
      `
      WITH inserted AS (
        INSERT INTO funding_review_comments (
          funding_id,
          review_id,
          user_id,
          content
        )
        VALUES ($1, $2, $3, $4)
        RETURNING
          comment_id,
          funding_id,
          review_id,
          user_id,
          content,
          created_at,
          updated_at
      )
      SELECT
        inserted.comment_id,
        inserted.funding_id,
        inserted.review_id,
        inserted.user_id,
        u.nickname AS writer_nickname,
        u.profile_image AS writer_profile_image,
        u.role AS writer_role,
        inserted.content,
        inserted.created_at,
        inserted.updated_at,
        0::int AS like_count,
        (inserted.user_id = fp.brewery_user_id) AS is_project_owner,
        false AS liked
      FROM inserted
      LEFT JOIN funding_projects fp ON fp.funding_id = inserted.funding_id
      LEFT JOIN users u ON u.user_id = inserted.user_id
      `,
      [resolvedFundingId, Number(reviewId), userId, content]
    );

    return res.status(201).json({
      ...mapFundingReviewComment(result.rows[0]),
      message: 'Q&A 처리가 완료되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: 'Q&A 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const getFundingReviewCommentById = async ({ fundingId, reviewId, commentId, userId }) => {
  const result = await pool.query(
    `
    SELECT
      frc.comment_id,
      frc.funding_id,
      frc.review_id,
      frc.user_id,
      u.nickname AS writer_nickname,
      u.profile_image AS writer_profile_image,
      u.role AS writer_role,
      frc.content,
      frc.created_at,
      frc.updated_at,
      COALESCE(like_counts.like_count, 0) AS like_count,
      (frc.user_id = fp.brewery_user_id) AS is_project_owner,
      EXISTS (
        SELECT 1
        FROM funding_review_comment_likes my_like
        WHERE my_like.comment_id = frc.comment_id
        AND my_like.user_id = $4
      ) AS liked
    FROM funding_review_comments frc
    LEFT JOIN funding_projects fp ON fp.funding_id = frc.funding_id
    LEFT JOIN users u ON u.user_id = frc.user_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS like_count
      FROM funding_review_comment_likes frcl
      WHERE frcl.comment_id = frc.comment_id
    ) like_counts ON TRUE
    WHERE frc.funding_id = $1
    AND frc.review_id = $2
    AND frc.comment_id = $3
    `,
    [Number(fundingId), Number(reviewId), Number(commentId), userId]
  );

  return result.rows[0] || null;
};

const likeFundingReviewComment = async (req, res) => {
  const { fundingId, reviewId, commentId } = req.params;
  const userId = requireUserId(req, res);
  if (!userId) return;
  const resolvedFundingId = await resolveFundingId(fundingId);

  if (
    !resolvedFundingId ||
    !reviewId ||
    isNaN(Number(reviewId)) ||
    !commentId ||
    isNaN(Number(commentId))
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    const comment = await getFundingReviewCommentById({
      fundingId: resolvedFundingId,
      reviewId,
      commentId,
      userId,
    });

    if (!comment) {
      return res.status(404).json({
        status: 404,
        message: 'Q&A를 찾을 수 없습니다.',
      });
    }

    await pool.query(
      `
      INSERT INTO funding_review_comment_likes (
        comment_id,
        user_id
      )
      VALUES ($1, $2)
      ON CONFLICT (comment_id, user_id) DO NOTHING
      `,
      [Number(commentId), userId]
    );

    const likedComment = await getFundingReviewCommentById({
      fundingId: resolvedFundingId,
      reviewId,
      commentId,
      userId,
    });

    return res.status(201).json({
      ...mapFundingReviewComment(likedComment),
      liked: true,
      message: 'Q&A 처리가 완료되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: 'Q&A 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const unlikeFundingReviewComment = async (req, res) => {
  const { fundingId, reviewId, commentId } = req.params;
  const userId = requireUserId(req, res);
  if (!userId) return;
  const resolvedFundingId = await resolveFundingId(fundingId);

  if (
    !resolvedFundingId ||
    !reviewId ||
    isNaN(Number(reviewId)) ||
    !commentId ||
    isNaN(Number(commentId))
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    const comment = await getFundingReviewCommentById({
      fundingId: resolvedFundingId,
      reviewId,
      commentId,
      userId,
    });

    if (!comment) {
      return res.status(404).json({
        status: 404,
        message: 'Q&A를 찾을 수 없습니다.',
      });
    }

    await pool.query(
      `
      DELETE FROM funding_review_comment_likes
      WHERE comment_id = $1
      AND user_id = $2
      `,
      [Number(commentId), userId]
    );

    const unlikedComment = await getFundingReviewCommentById({
      fundingId: resolvedFundingId,
      reviewId,
      commentId,
      userId,
    });

    return res.status(200).json({
      ...mapFundingReviewComment(unlikedComment),
      liked: false,
      message: 'Q&A 처리가 완료되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: 'Q&A 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// Q&A 처리 로직
const likeFundingProject = async (req, res) => {
  const { fundingId } = req.params;
  const resolvedFundingId = await resolveFundingId(fundingId);

  if (!resolvedFundingId) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    await pool.query(
      `
      INSERT INTO funding_likes (
        user_id,
        funding_id
      )
      VALUES ($1, $2)
      ON CONFLICT (user_id, funding_id) DO NOTHING
      `,
      [userId, resolvedFundingId]
    );

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS like_count
      FROM funding_likes
      WHERE funding_id = $1
      `,
      [resolvedFundingId]
    );

    return res.status(201).json({
      fundingId: resolvedFundingId,
      liked: true,
      likeCount: countResult.rows[0].like_count,
      message: '요청 처리가 완료되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '요청 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 처리 로직
const unlikeFundingProject = async (req, res) => {
  const { fundingId } = req.params;
  const resolvedFundingId = await resolveFundingId(fundingId);

  if (!resolvedFundingId) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    await pool.query(
      `
      DELETE FROM funding_likes
      WHERE user_id = $1
      AND funding_id = $2
      `,
      [userId, resolvedFundingId]
    );

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS like_count
      FROM funding_likes
      WHERE funding_id = $1
      `,
      [resolvedFundingId]
    );

    return res.status(200).json({
      fundingId: resolvedFundingId,
      liked: false,
      likeCount: countResult.rows[0].like_count,
      message: '요청 처리가 완료되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '요청 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 펀딩 처리 로직
const likeBreweryLog = async (req, res) => {
  const { fundingId, breweryLogId } = req.params;
  const userId = requireUserId(req, res);
  if (!userId) return;

  if (!fundingId || isNaN(Number(fundingId)) || !breweryLogId || isNaN(Number(breweryLogId))) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    const logResult = await pool.query(
      `
      SELECT log_id
      FROM brewery_logs
      WHERE funding_id = $1
      AND log_id = $2
      `,
      [Number(fundingId), Number(breweryLogId)]
    );

    if (logResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 프로젝트를 찾을 수 없습니다.',
      });
    }

    await pool.query(
      `
      INSERT INTO brewery_log_likes (
        brewery_log_id,
        user_id
      )
      VALUES ($1, $2)
      ON CONFLICT (brewery_log_id, user_id) DO NOTHING
      `,
      [Number(breweryLogId), userId]
    );

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS like_count
      FROM brewery_log_likes
      WHERE brewery_log_id = $1
      `,
      [Number(breweryLogId)]
    );

    return res.status(201).json({
      fundingId: Number(fundingId),
      breweryLogId: Number(breweryLogId),
      liked: true,
      likeCount: countResult.rows[0].like_count,
      message: '요청 처리가 완료되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '요청 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 처리 로직
const unlikeBreweryLog = async (req, res) => {
  const { fundingId, breweryLogId } = req.params;
  const userId = requireUserId(req, res);
  if (!userId) return;

  if (!fundingId || isNaN(Number(fundingId)) || !breweryLogId || isNaN(Number(breweryLogId))) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    await pool.query(
      `
      DELETE FROM brewery_log_likes
      WHERE brewery_log_id = $1
      AND user_id = $2
      `,
      [Number(breweryLogId), userId]
    );

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS like_count
      FROM brewery_log_likes
      WHERE brewery_log_id = $1
      `,
      [Number(breweryLogId)]
    );

    return res.status(200).json({
      fundingId: Number(fundingId),
      breweryLogId: Number(breweryLogId),
      liked: false,
      likeCount: countResult.rows[0].like_count,
      message: '요청 처리가 완료되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '요청 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 펀딩 처리 로직
const createBreweryLogComment = async (req, res) => {
  const { fundingId, breweryLogId } = req.params;
  const { content } = req.body;
  const resolvedFundingId = await resolveFundingId(fundingId);

  if (
    !resolvedFundingId ||
    !breweryLogId ||
    isNaN(Number(breweryLogId))
  ) {
    return res.status(404).json({
      status: 404,
      message: 'Q&A를 찾을 수 없습니다.',
    });
  }

  if (
    !content ||
    typeof content !== 'string' ||
    content.trim() === ''
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    // Q&A 처리 로직
    const breweryLogResult = await pool.query(
      `
      SELECT log_id
      FROM brewery_logs
      WHERE log_id = $1
      AND funding_id = $2
      `,
      [Number(breweryLogId), resolvedFundingId]
    );

    if (breweryLogResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: 'Q&A를 찾을 수 없습니다.',
      });
    }

    const result = await pool.query(
      `
      WITH inserted AS (
        INSERT INTO brewery_log_comments (
          brewery_log_id,
          user_id,
          content
        )
        VALUES ($1, $2, $3)
        RETURNING
          comment_id,
          brewery_log_id,
          user_id,
          content,
          created_at,
          updated_at
      )
      SELECT
        inserted.comment_id,
        inserted.brewery_log_id,
        inserted.user_id,
        u.nickname AS writer_nickname,
        u.profile_image AS writer_profile_image,
        u.role AS writer_role,
        inserted.content,
        inserted.created_at,
        inserted.updated_at
      FROM inserted
      LEFT JOIN users u ON u.user_id = inserted.user_id
      `,
      [
        Number(breweryLogId),
        userId,
        content.trim(),
      ]
    );

    const comment = result.rows[0];
    const writerRole = normalizeWriterRole(comment.writer_role);
    const writerIsBrewery = isBreweryWriterRole(writerRole);

    return res.status(201).json({
      commentId: Number(comment.comment_id),
      breweryLogId: Number(comment.brewery_log_id),
      userId: Number(comment.user_id),
      user_id: Number(comment.user_id),
      writerId: Number(comment.user_id),
      writer_id: Number(comment.user_id),
      writerNickname: comment.writer_nickname || '익명',
      writerProfileImage: comment.writer_profile_image || null,
      profileImage: comment.writer_profile_image || null,
      writerRole,
      role: writerRole,
      isBrewery: writerIsBrewery,
      writerIsBrewery,
      content: comment.content,
      likeCount: 0,
      liked: false,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
      replies: [],
      message: '요청 처리 중 오류가 발생했습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: 'Q&A 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// Q&A 처리 로직
const createBreweryLogReply = async (req, res) => {
  const { fundingId, breweryLogId, commentId } = req.params;
  const { content } = req.body;
  const resolvedFundingId = await resolveFundingId(fundingId);

  if (
    !resolvedFundingId ||
    !breweryLogId ||
    isNaN(Number(breweryLogId)) ||
    !commentId ||
    isNaN(Number(commentId))
  ) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  if (
    !content ||
    typeof content !== 'string' ||
    content.trim() === ''
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    // 펀딩 처리 로직
    const parentCommentResult = await pool.query(
      `
      SELECT
        comment_id,
        parent_comment_id
      FROM brewery_log_comments
      WHERE comment_id = $1
      AND brewery_log_id = $2
      `,
      [Number(commentId), Number(breweryLogId)]
    );

    if (parentCommentResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 프로젝트를 찾을 수 없습니다.',
      });
    }

    const parentComment = parentCommentResult.rows[0];

    // 펀딩 처리 로직
    if (parentComment.parent_comment_id !== null) {
      return res.status(400).json({
        status: 400,
        message: '요청 값이 올바르지 않습니다.',
      });
    }

    const result = await pool.query(
      `
      WITH inserted AS (
        INSERT INTO brewery_log_comments (
          brewery_log_id,
          user_id,
          parent_comment_id,
          content
        )
        VALUES ($1, $2, $3, $4)
        RETURNING
          comment_id,
          brewery_log_id,
          user_id,
          parent_comment_id,
          content,
          created_at,
          updated_at
      )
      SELECT
        inserted.comment_id,
        inserted.brewery_log_id,
        inserted.user_id,
        u.nickname AS writer_nickname,
        u.profile_image AS writer_profile_image,
        u.role AS writer_role,
        inserted.parent_comment_id,
        inserted.content,
        inserted.created_at,
        inserted.updated_at
      FROM inserted
      LEFT JOIN users u ON u.user_id = inserted.user_id
      `,
      [
        Number(breweryLogId),
        userId,
        Number(commentId),
        content.trim(),
      ]
    );

    const reply = result.rows[0];
    const writerRole = normalizeWriterRole(reply.writer_role);
    const writerIsBrewery = isBreweryWriterRole(writerRole);

    return res.status(201).json({
      replyId: Number(reply.comment_id),
      commentId: Number(reply.comment_id),
      parentCommentId: Number(reply.parent_comment_id),
      breweryLogId: Number(reply.brewery_log_id),
      userId: Number(reply.user_id),
      user_id: Number(reply.user_id),
      writerId: Number(reply.user_id),
      writer_id: Number(reply.user_id),
      writerNickname: reply.writer_nickname || '익명',
      writerProfileImage: reply.writer_profile_image || null,
      profileImage: reply.writer_profile_image || null,
      writerRole,
      role: writerRole,
      isBrewery: writerIsBrewery,
      writerIsBrewery,
      content: reply.content,
      likeCount: 0,
      liked: false,
      createdAt: reply.created_at,
      updatedAt: reply.updated_at,
      message: '요청 처리 중 오류가 발생했습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '요청 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 펀딩 처리 로직
const getBreweryLogComments = async (req, res) => {
  const { fundingId, breweryLogId } = req.params;
  const userId = getUserId(req);
  const resolvedFundingId = await resolveFundingId(fundingId);

  if (
    !resolvedFundingId ||
    !breweryLogId ||
    isNaN(Number(breweryLogId))
  ) {
    return res.status(404).json({
      status: 404,
      message: 'Q&A를 찾을 수 없습니다.',
    });
  }

  try {
    const commentResult = await pool.query(
      `
      SELECT
        c.comment_id,
        c.brewery_log_id,
        c.user_id,
        u.nickname AS writer_nickname,
        u.profile_image AS writer_profile_image,
        u.role AS writer_role,
        c.parent_comment_id,
        c.content,
        c.created_at,
        c.updated_at,
        COALESCE(lc.like_count, 0) AS like_count,
        EXISTS (
          SELECT 1
          FROM brewery_log_comment_likes bcl
          WHERE bcl.comment_id = c.comment_id
          AND bcl.user_id = $2
        ) AS liked
      FROM brewery_log_comments c
      LEFT JOIN users u ON u.user_id = c.user_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS like_count
        FROM brewery_log_comment_likes
        WHERE comment_id = c.comment_id
      ) lc ON TRUE
      WHERE c.brewery_log_id = $1
      ORDER BY c.created_at ASC
      `,
      [Number(breweryLogId), userId]
    );

    const comments = commentResult.rows.filter(
      (comment) => comment.parent_comment_id === null
    );

    const replies = commentResult.rows.filter(
      (comment) => comment.parent_comment_id !== null
    );

    const content = comments.map((comment) => {
      const writerRole = normalizeWriterRole(comment.writer_role);
      const writerIsBrewery = isBreweryWriterRole(writerRole);
      const writerId = toNullableNumber(comment.user_id);

      return {
        commentId: Number(comment.comment_id),
        breweryLogId: Number(comment.brewery_log_id),
        userId: writerId,
        user_id: writerId,
        writerId,
        writer_id: writerId,
        writerNickname: comment.writer_nickname || '익명',
        writerProfileImage: comment.writer_profile_image || null,
        profileImage: comment.writer_profile_image || null,
        writerRole,
        role: writerRole,
        isBrewery: writerIsBrewery,
        writerIsBrewery,
        content: comment.content,
        likeCount: Number(comment.like_count || 0),
        liked: comment.liked,
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
        replies: replies
          .filter((reply) => Number(reply.parent_comment_id) === Number(comment.comment_id))
          .map((reply) => {
            const replyWriterRole = normalizeWriterRole(reply.writer_role);
            const replyWriterIsBrewery = isBreweryWriterRole(replyWriterRole);
            const replyWriterId = toNullableNumber(reply.user_id);

            return {
              replyId: Number(reply.comment_id),
              commentId: Number(reply.comment_id),
              parentCommentId: Number(reply.parent_comment_id),
              breweryLogId: Number(reply.brewery_log_id),
              userId: replyWriterId,
              user_id: replyWriterId,
              writerId: replyWriterId,
              writer_id: replyWriterId,
              writerNickname: reply.writer_nickname || '익명',
              writerProfileImage: reply.writer_profile_image || null,
              profileImage: reply.writer_profile_image || null,
              writerRole: replyWriterRole,
              role: replyWriterRole,
              isBrewery: replyWriterIsBrewery,
              writerIsBrewery: replyWriterIsBrewery,
              content: reply.content,
              likeCount: Number(reply.like_count || 0),
              liked: reply.liked,
              createdAt: reply.created_at,
              updatedAt: reply.updated_at,
            };
          }),
      };
    });

    return res.status(200).json({
      fundingId: resolvedFundingId,
      breweryLogId: Number(breweryLogId),
      comments: content,
      commentCount: content.length,
      message: 'Q&A 처리가 완료되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: 'Q&A 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// Q&A 처리 로직
const likeBreweryLogComment = async (req, res) => {
  const { fundingId, breweryLogId, commentId, replyId } = req.params;
  const targetCommentId = replyId || commentId;
  const userId = requireUserId(req, res);
  if (!userId) return;

  if (!targetCommentId || isNaN(Number(targetCommentId))) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    const commentResult = await pool.query(
      `
      SELECT
        comment_id,
        parent_comment_id,
        brewery_log_id
      FROM brewery_log_comments
      WHERE comment_id = $1
      AND ($2::bigint IS NULL OR brewery_log_id = $2)
      AND ($3::bigint IS NULL OR parent_comment_id = $3)
      `,
      [
        Number(targetCommentId),
        breweryLogId && !isNaN(Number(breweryLogId)) ? Number(breweryLogId) : null,
        replyId ? Number(commentId) : null,
      ]
    );

    if (commentResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: 'Q&A를 찾을 수 없습니다.',
      });
    }

    await pool.query(
      `
      INSERT INTO brewery_log_comment_likes (
        comment_id,
        user_id
      )
      VALUES ($1, $2)
      ON CONFLICT (comment_id, user_id) DO NOTHING
      `,
      [Number(targetCommentId), userId]
    );

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS like_count
      FROM brewery_log_comment_likes
      WHERE comment_id = $1
      `,
      [Number(targetCommentId)]
    );

    return res.status(201).json({
      fundingId: fundingId ? Number(fundingId) : undefined,
      breweryLogId: breweryLogId ? Number(breweryLogId) : undefined,
      commentId: replyId ? Number(commentId) : Number(targetCommentId),
      replyId: replyId ? Number(replyId) : undefined,
      liked: true,
      likeCount: Number(countResult.rows[0].like_count || 0),
      message: '요청 처리 중 오류가 발생했습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: 'Q&A 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// Q&A 처리 로직
const unlikeBreweryLogComment = async (req, res) => {
  const { fundingId, breweryLogId, commentId, replyId } = req.params;
  const targetCommentId = replyId || commentId;
  const userId = requireUserId(req, res);
  if (!userId) return;

  if (!targetCommentId || isNaN(Number(targetCommentId))) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    await pool.query(
      `
      DELETE FROM brewery_log_comment_likes
      WHERE comment_id = $1
      AND user_id = $2
      `,
      [Number(targetCommentId), userId]
    );

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS like_count
      FROM brewery_log_comment_likes
      WHERE comment_id = $1
      `,
      [Number(targetCommentId)]
    );

    return res.status(200).json({
      fundingId: fundingId ? Number(fundingId) : undefined,
      breweryLogId: breweryLogId ? Number(breweryLogId) : undefined,
      commentId: replyId ? Number(commentId) : Number(targetCommentId),
      replyId: replyId ? Number(replyId) : undefined,
      liked: false,
      likeCount: Number(countResult.rows[0].like_count || 0),
      message: '요청 처리 중 오류가 발생했습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: 'Q&A 처리 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const sendFundingReviewError = (res, error, fallbackMessage) => {
  const status = error.status || 500;

  console.error(error.stack || error);

  return res.status(status).json({
    status,
    message: status === 500 ? fallbackMessage : error.message,
  });
};

const createFundingReviewStable = async (req, res) => {
  const { fundingId } = req.params;
  const {
    rating,
    title,
    content,
    detailReview,
    mood,
    pairing,
    tags,
    recordVisibility = true,
    showRecord,
    imageUrls,
  } = req.body || {};
  const files = req.files || [];

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 후기를 찾을 수 없습니다.',
    });
  }

  const normalizedContent = toTrimmedString(content || detailReview);

  if (!normalizedContent) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const normalizedRating = normalizeReviewRatingInput(rating, { required: true });

    const paidOrder = await findPaidFundingOrder(Number(fundingId), userId);
    if (!paidOrder) {
      return res.status(403).json({
        status: 403,
        message: '접근 권한이 없습니다.',
      });
    }

    const existingReview = await findFundingReviewByUser(Number(fundingId), userId);
    if (existingReview) {
      return res.status(409).json({
        status: 409,
        message: '이미 처리된 요청입니다.',
        data: {
          reviewId: Number(existingReview.review_id),
        },
      });
    }

    const uploadedImageUrls = [];
    for (const file of files) {
      uploadedImageUrls.push(await storeUploadedFile(file, `funding-reviews/${fundingId}`, userId));
    }

    const normalizedImageUrls = uniqueValues([
      ...normalizeReviewImageUrlsInput(imageUrls),
      ...normalizeReviewImageUrlsInput(uploadedImageUrls),
    ]);
    const normalizedTags = normalizeReviewTagsInput(tags);
    const normalizedRecordVisibility =
      parseOptionalBoolean(showRecord) ??
      parseOptionalBoolean(recordVisibility) ??
      true;

    const result = await pool.query(
      `
      INSERT INTO funding_reviews (
        funding_id,
        user_id,
        rating,
        title,
        content,
        image_urls,
        mood,
        pairing,
        tags,
        record_visibility
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING
        review_id,
        funding_id,
        user_id,
        rating,
        title,
        content,
        image_urls,
        mood,
        pairing,
        tags,
        record_visibility,
        created_at,
        updated_at
      `,
      [
        Number(fundingId),
        userId,
        normalizedRating,
        title || null,
        normalizedContent,
        JSON.stringify(normalizedImageUrls),
        mood || null,
        pairing || null,
        JSON.stringify(normalizedTags),
        normalizedRecordVisibility,
      ]
    );

    const createdReview = result.rows[0];
    if (!createdReview) {
      throw createHttpError(500, '펀딩 후기 처리 중 오류가 발생했습니다.');
    }

    let review = createdReview;
    try {
      review = await getFundingReviewById({
        fundingId: Number(fundingId),
        reviewId: createdReview.review_id,
        userId,
      }) || createdReview;
    } catch (lookupError) {
      console.warn('Funding review lookup failed after create', {
        fundingId: Number(fundingId),
        reviewId: Number(createdReview.review_id),
        userId,
        message: lookupError.message,
      });
    }

    let aiTasteUpdate = null;
    try {
      aiTasteUpdate = await updateFundingReviewAiTasteProfile({
        userId,
        review,
        requestBody: req.body || {},
        isCreate: true,
      });
    } catch (aiError) {
      console.warn('Funding review AI taste update failed after review create', {
        fundingId: Number(fundingId),
        reviewId: Number(createdReview.review_id),
        userId,
        message: aiError.message,
      });
      aiTasteUpdate = {
        updated: false,
        message: '요청 처리 중 오류가 발생했습니다.',
      };
    }

    return res.status(201).json(buildFundingReviewResponse({
      status: 201,
      message: '펀딩 후기 처리가 완료되었습니다.',
      review,
      aiTasteUpdate,
    }));
  } catch (error) {
    return sendFundingReviewError(res, error, '펀딩 후기 작성 중 오류가 발생했습니다.');
  }
};

const updateFundingReviewStable = async (req, res) => {
  const { fundingId, reviewId } = req.params;
  const {
    rating,
    title,
    content,
    detailReview,
    mood,
    pairing,
    tags,
    recordVisibility,
    showRecord,
    imageUrls,
    deleteImageUrls,
  } = req.body || {};
  const files = req.files || [];

  if (
    !fundingId ||
    isNaN(Number(fundingId)) ||
    !reviewId ||
    isNaN(Number(reviewId))
  ) {
    return res.status(400).json({
      status: 400,
      message: '요청 값이 올바르지 않습니다.',
    });
  }

  try {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const normalizedRating = normalizeReviewRatingInput(rating);

    const existingResult = await pool.query(
      `
      SELECT *
      FROM funding_reviews
      WHERE funding_id = $1
        AND review_id = $2
      `,
      [Number(fundingId), Number(reviewId)]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 후기를 찾을 수 없습니다.',
      });
    }

    const current = existingResult.rows[0];
    const writerId = Number(current.user_id);
    if (writerId !== userId && !isAdminUser(req.user)) {
      return res.status(403).json({
        status: 403,
        message: '접근 권한이 없습니다.',
      });
    }

    const uploadedImageUrls = [];
    for (const file of files) {
      uploadedImageUrls.push(await storeUploadedFile(file, `funding-reviews/${fundingId}`, userId));
    }

    const deleteImageUrlSet = new Set(normalizeReviewImageUrlsInput(deleteImageUrls, 'deleteImageUrls'));
    const currentImageUrls = normalizeReviewImageUrlsInput(current.image_urls);
    const baseImageUrls = imageUrls !== undefined
      ? normalizeReviewImageUrlsInput(imageUrls)
      : currentImageUrls;
    const nextImageUrls = uniqueValues([
      ...baseImageUrls.filter((imageUrl) => !deleteImageUrlSet.has(imageUrl)),
      ...normalizeReviewImageUrlsInput(uploadedImageUrls),
    ]);
    const nextTags = tags !== undefined ? normalizeReviewTagsInput(tags) : null;
    const nextContent = toTrimmedString(content || detailReview) || current.content;
    const nextRecordVisibility =
      parseOptionalBoolean(showRecord) ??
      parseOptionalBoolean(recordVisibility) ??
      current.record_visibility;

    const result = await pool.query(
      `
      UPDATE funding_reviews
      SET
        rating = COALESCE($1::numeric, rating),
        title = COALESCE($2, title),
        content = $3,
        image_urls = $4,
        mood = COALESCE($5, mood),
        pairing = COALESCE($6, pairing),
        tags = COALESCE($7, tags),
        record_visibility = $8,
        updated_at = CURRENT_TIMESTAMP
      WHERE review_id = $9
      RETURNING
        review_id,
        funding_id,
        user_id,
        rating,
        title,
        content,
        image_urls,
        mood,
        pairing,
        tags,
        record_visibility,
        created_at,
        updated_at
      `,
      [
        normalizedRating,
        title || null,
        nextContent,
        JSON.stringify(nextImageUrls),
        mood || null,
        pairing || null,
        nextTags !== null ? JSON.stringify(nextTags) : null,
        nextRecordVisibility,
        Number(reviewId),
      ]
    );

    const updatedReview = result.rows[0];
    if (!updatedReview) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 후기를 찾을 수 없습니다.',
      });
    }

    let review = updatedReview;
    try {
      review = await getFundingReviewById({
        fundingId: Number(fundingId),
        reviewId: updatedReview.review_id,
        userId,
      }) || updatedReview;
    } catch (lookupError) {
      console.warn('Funding review lookup failed after update', {
        fundingId: Number(fundingId),
        reviewId: Number(updatedReview.review_id),
        userId,
        message: lookupError.message,
      });
    }

    let aiTasteUpdate = null;
    try {
      aiTasteUpdate = await updateFundingReviewAiTasteProfile({
        userId: writerId || userId,
        review,
        requestBody: req.body || {},
        isCreate: false,
      });
    } catch (aiError) {
      console.warn('Funding review AI taste update failed after review update', {
        fundingId: Number(fundingId),
        reviewId: Number(updatedReview.review_id),
        userId: writerId || userId,
        message: aiError.message,
      });
      aiTasteUpdate = {
        updated: false,
        message: '요청 처리 중 오류가 발생했습니다.',
      };
    }

    return res.status(200).json(buildFundingReviewResponse({
      status: 200,
      message: '펀딩 후기 처리가 완료되었습니다.',
      review,
      aiTasteUpdate,
    }));
  } catch (error) {
    return sendFundingReviewError(res, error, '펀딩 후기 수정 중 오류가 발생했습니다.');
  }
};

module.exports = {
  saveAgreement,
  createFundingDraft,
  updateFundingDraft,
  saveBasicInfo,
  saveSchedule,
  saveLegalInfo,
  saveTasteProfile,
  savePlan,
  saveBreweryInfo,
  loadBreweryInfo, // 양조장 정보 불러오기
  uploadFundingDraftFile,
  generateFundingDraftAiImage,
  verifyPhoneForFundingDraft,
  verifyAccountForFundingDraft, // 입금 계좌 인증
  requestBankAccountVerification,
  confirmBankAccountVerification,
  saveNotices,
  uploadDocument,
  submitFundingDraft, // 펀딩 심사 제출
  getFundingDraft,    // 펀딩 임시저장 단건 조회
  getFundingDraftByFundingId,
  getFundingDraftList, // 펀딩 임시저장 목록 조회
  deleteFundingDraft,  // 펀딩 임시저장 삭제
  getFundingDraftPreview,  // 펀딩 프로젝트 미리보기
  updateFundingProject, // 펀딩 프로젝트 수정
  getFundingList,
  getFundingStats,
  getFundingDetail,
  getFundingIntro,
  getBreweryLogs,
  getFundingQuestions,
  createFundingQuestion,
  createFundingReply,
  likeFundingQuestion,
  unlikeFundingQuestion,
  likeFundingQuestionReply,
  unlikeFundingQuestionReply,
  getFundingReviews,
  getFundingReviewDetail,
  likeFundingReview,
  unlikeFundingReview,
  getSupportOptions,
  createFundingOrder,
  createFundingInquiry,
  getFundingShareLink,

  createBreweryLog,
  updateBreweryLog,
  deleteBreweryLog,
  getFundingShareLink,
  createFundingReport,
  getFundingReports,
  createFundingReview: createFundingReviewStable,
  updateFundingReview: updateFundingReviewStable,
  deleteFundingReview,
  getFundingReviewComments,
  createFundingReviewComment,
  likeFundingReviewComment,
  unlikeFundingReviewComment,
  likeFundingProject,
  unlikeFundingProject,
  likeBreweryLog,
  unlikeBreweryLog,
  createBreweryLogComment,
  createBreweryLogReply,
  getBreweryLogComments,
  likeBreweryLogComment,
  unlikeBreweryLogComment,
};
