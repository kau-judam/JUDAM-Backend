const crypto = require('crypto');
const pool = require('../config/db');
const { uploadFileToS3 } = require('../services/s3.service');
const {
  isAiFundingRegistrationStatus,
  registerFundingProjectToAiPool,
} = require('../services/funding.service');
const { updateAiTasteProfile } = require('../services/ai.service');

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

const FUNDING_OWNER_FORBIDDEN_MESSAGE = '해당 펀딩 프로젝트에 대한 권한이 없습니다.';
const AUTH_REQUIRED_MESSAGE = '유효하지 않거나 만료된 토큰입니다.';

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
    SELECT funding_id, brewery_user_id
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

const assertFundingDraftOwner = async (draftId, user) => {
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
    throw createHttpError(404, '임시저장 프로젝트를 찾을 수 없습니다.');
  }

  const draft = rows[0];

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

const authorizeFundingDraftOwner = async (draftId, user, res) => {
  try {
    await assertFundingDraftOwner(draftId, user);
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

const buildImageFields = (thumbnailUrl, imageUrlsValue) => {
  const parsedImageUrls = uniqueValues(parseJsonArrayField(imageUrlsValue)).slice(0, 5);
  const normalizedThumbnailUrl = toTrimmedString(thumbnailUrl) || parsedImageUrls[0] || null;
  const imageUrls = parsedImageUrls.filter((imageUrl) => imageUrl !== normalizedThumbnailUrl);
  const allImageUrls = uniqueValues([normalizedThumbnailUrl, ...imageUrls].filter(Boolean)).slice(0, 5);

  return {
    thumbnailUrl: normalizedThumbnailUrl,
    imageUrls,
    allImageUrls,
  };
};

const mapFundingImageUrls = (imageUrls = []) =>
  (imageUrls || []).slice(0, 5).map((imageUrl, index) => ({
    imageId: index + 1,
    imageUrl,
    displayOrder: index + 1,
  }));

const PLAN_GUIDES = {
  budgetPlanGuide: '프로젝트 예산은 "- 프로젝트 예산임: 25만원" 형식으로 작성하면 UI에 잘 반영됩니다.',
  schedulePlanGuide: '프로젝트 일정은 "- 프로젝트 일정: 일정내용" 형식으로 작성하면 UI에 잘 반영됩니다.',
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
    flavorNotes: extras.flavorNotes,
    flavorTags: extras.flavorTags,
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
  toTrimmedString(accountNumber).replace(/[\s-]/g, '');

const getBankVerificationFields = (body = {}) => ({
  bankName: toTrimmedString(getBodyValue(body, ['bankName', 'bank_name'])),
  accountNumber: toTrimmedString(getBodyValue(body, ['accountNumber', 'account_number'])),
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

const calculateSulbtiMatchScore = (sulbti, taste) => {
  if (!sulbti || !taste) return null;

  const axes = [
    [normalizeSulbtiScore(sulbti.sweetness_score), taste.sweetness],
    [normalizeSulbtiScore(sulbti.body_score), taste.body],
    [normalizeSulbtiScore(sulbti.carbonation_score), taste.carbonation],
    [normalizeSulbtiScore(sulbti.abv_score), taste.alcohol_intensity],
  ].filter(([preferred, actual]) => preferred !== null && actual !== null && actual !== undefined);

  if (axes.length === 0) return null;

  const total = axes.reduce((sum, [preferred, actual]) => (
    sum + Math.max(0, 100 - Math.abs(preferred - Number(actual)))
  ), 0);

  return Math.round(total / axes.length);
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
  createdAt: document.created_at,
});

const mapFundingReview = (review) => {
  const writerId = review.user_id === null || review.user_id === undefined
    ? null
    : Number(review.user_id);

  return {
    reviewId: Number(review.review_id),
    fundingId: Number(review.funding_id),
    writerId,
    writer_id: writerId,
    userId: writerId,
    user_id: writerId,
    writerNickname: review.writer_nickname || '사용자',
    writerProfileImage: review.writer_profile_image || null,
    profileImage: review.writer_profile_image || null,
    writerRole: normalizeWriterRole(review.writer_role),
    role: normalizeWriterRole(review.writer_role),
    isBrewery: isBreweryWriterRole(review.writer_role),
    writerIsBrewery: isBreweryWriterRole(review.writer_role),
    rating: Number(review.rating),
    title: review.title,
    content: review.content,
    detailReview: review.content,
    imageUrls: parseJsonField(review.image_urls),
    mood: review.mood,
    pairing: review.pairing,
    tags: parseJsonField(review.tags),
    recordVisibility: review.record_visibility,
    showRecord: review.record_visibility,
    likeCount: Number(review.like_count || 0),
    liked: Boolean(review.liked),
    createdAt: review.created_at,
    updatedAt: review.updated_at,
  };
};

const mapFundingReviewComment = (comment) => {
  const writerId = comment.user_id === null || comment.user_id === undefined
    ? null
    : Number(comment.user_id);

  return {
    commentId: Number(comment.comment_id),
    fundingId: Number(comment.funding_id),
    reviewId: Number(comment.review_id),
    writerId,
    writer_id: writerId,
    userId: writerId,
    user_id: writerId,
    writerNickname: comment.writer_nickname || '사용자',
    writerProfileImage: comment.writer_profile_image || null,
    profileImage: comment.writer_profile_image || null,
    writerRole: normalizeWriterRole(comment.writer_role),
    role: normalizeWriterRole(comment.writer_role),
    isBrewery: isBreweryWriterRole(comment.writer_role),
    writerIsBrewery: isBreweryWriterRole(comment.writer_role),
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
  const rawMaterials = parseFundingListField(draft.raw_materials);
  const tags = parseJsonField(draft.tags);
  const budgetPlan = parseOriginalTextField(draft.budget_plan);
  const schedulePlan = parseOriginalTextField(draft.schedule_plan);
  const businessNumber = draft.business_registration_number || draft.license_number || null;
  const tasteProfile = buildTasteProfileResponse(draft);
  const projectPolicy = parseOriginalTextField(draft.refund_policy || draft.exchange_policy);

  return {
    draftId: Number(draft.draft_id),
    fundingId: draft.funding_id === null || draft.funding_id === undefined
      ? null
      : Number(draft.funding_id),
    breweryId: draft.brewery_id === null || draft.brewery_id === undefined
      ? null
      : Number(draft.brewery_id),
    status: draft.status,
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
      alcoholPercentage: draft.alcohol_percentage,
      summary: draft.summary,
      thumbnailUrl: imageFields.thumbnailUrl,
      imageUrl: imageFields.thumbnailUrl,
      imageUrls: imageFields.imageUrls,
      allImageUrls: imageFields.allImageUrls,
      images: mapFundingImageUrls(imageFields.allImageUrls),
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
      fundingEndDate: draft.funding_end_date,
      endDate: draft.funding_end_date,
      expectedDeliveryDate: draft.expected_delivery_date,
      platformFeeRate: draft.platform_fee_rate,
      platformFeeAmount: draft.platform_fee_amount,
      shippingFee: draft.shipping_fee,
      maxSupportAmount: draft.max_support_amount ?? null,
      minSupportAmount: draft.min_support_amount ?? null,
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
      adultOnly: draft.adult_only ?? null,
      termsAgreed: draft.all_required_terms_agreed ?? null,
      privacyAgreed: draft.privacy_agreed ?? null,
    },

    tasteProfile,

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

    notices: {
      refundPolicy: projectPolicy,
      exchangePolicy: projectPolicy,
      adultVerificationNotice: draft.adult_verification_notice,
      riskNotice: draft.risk_notice,
      notice: draft.adult_verification_notice || draft.risk_notice || null,
      policy: projectPolicy,
    },

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

const findAndLinkFundingDraftByFundingId = async (fundingId) => {
  const directDraft = await findDirectFundingDraftByFundingId(fundingId);

  if (directDraft) {
    return directDraft;
  }

  const fallbackDraft = await findFallbackFundingDraftByFundingId(fundingId);

  if (!fallbackDraft) {
    return null;
  }

  const { rows } = await pool.query(
    `
    UPDATE funding_drafts
    SET
      funding_id = $1,
      updated_at = CURRENT_TIMESTAMP
    WHERE draft_id = $2
      AND funding_id IS NULL
    RETURNING *
    `,
    [Number(fundingId), Number(fallbackDraft.draft_id)]
  );

  return rows[0] || {
    ...fallbackDraft,
    funding_id: Number(fundingId),
  };
};

const syncFundingProjectFieldsFromDraft = async (draftId) => {
  const { rows } = await pool.query(
    `
    SELECT funding_id, image_urls
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
        normalizeJsonStorageValue(draft.image_urls, []),
        Number(draft.funding_id),
      ]
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

  if (process.env.AWS_S3_BUCKET && process.env.AWS_REGION) {
    try {
      return await uploadFileToS3(file.buffer, file.originalname, file.mimetype, ownerId);
    } catch (error) {
      if (process.env.FILE_UPLOAD_STRICT_S3 === 'true') {
        throw error;
      }
    }
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

// 펀딩 약관 동의
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
      message: '필수 약관에 모두 동의해야 합니다.',
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
      message: '펀딩 약관 동의가 저장되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '펀딩 약관 동의 저장 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 프로젝트 임시저장 생성(수정 버전)
const createFundingDraft = async (req, res) => {
  const {
    breweryId,
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
  } = req.body;

  if (!breweryId) {
    return res.status(400).json({
      status: 400,
      message: '양조장 ID는 필수입니다.',
    });
  }

  if (!authorizeBreweryUserId(breweryId, req.user, res)) return;

    if (imageUrls && !Array.isArray(imageUrls)) {
      return res.status(400).json({
        status: 400,
        message: '대표 이미지 목록 입력값이 올바르지 않습니다.',
      });
    }

    if (imageUrls && imageUrls.length > 5) {
      return res.status(400).json({
        status: 400,
        message: '대표 이미지는 최대 5개까지 등록할 수 있습니다.',
      });
    }

    if (tags && !Array.isArray(tags)) {
      return res.status(400).json({
        status: 400,
        message: '검색 태그 입력값이 올바르지 않습니다.',
      });
    }

    const normalizedImageUrls = imageUrls || [];
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
    const result = await pool.query(
      `
      INSERT INTO funding_drafts (
        brewery_id,
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
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'DRAFT', $12)
      RETURNING draft_id, brewery_id, thumbnail_url, image_urls, tags, status, progress_rate, created_at
      `,
      [
        Number(breweryId),
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
        progressRate,
      ]
    );

    const draft = result.rows[0];
    const imageFields = buildImageFields(draft.thumbnail_url, draft.image_urls);

    return res.status(201).json({
      draftId: draft.draft_id,
      breweryId: draft.brewery_id,
      status: draft.status,
      progressRate: draft.progress_rate,
      createdAt: draft.created_at,
      thumbnailUrl: imageFields.thumbnailUrl,
      imageUrls: imageFields.imageUrls,
      allImageUrls: imageFields.allImageUrls,
      images: mapFundingImageUrls(imageFields.allImageUrls),
      tags: draft.tags,
      message: '펀딩 프로젝트가 임시저장되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '펀딩 프로젝트 임시저장 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 임시저장 프로젝트 수정 (임시저장 수정용!)
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
      message: '입력값이 올바르지 않습니다.',
    });
  }

  const normalizedSubIngredients = hasSubIngredients
    ? parseFundingListField(subIngredients)
    : undefined;
  const normalizedImageUrls = hasImageUrls
    ? parseFundingListField(imageUrls)
    : undefined;
  const normalizedTags = hasTags
    ? parseFundingListField(tags)
    : undefined;

  if (hasImageUrls && normalizedImageUrls.length > 5) {
    return res.status(400).json({
      status: 400,
      message: '대표 이미지는 최대 5개까지 등록할 수 있습니다.',
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
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res))) return;

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
        message: '임시저장 프로젝트를 찾을 수 없습니다.',
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
        policy: parseOriginalTextField(draft.refund_policy || draft.exchange_policy),
      },
      message: '임시저장 프로젝트가 수정되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '임시저장 프로젝트 수정 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 프로젝트 기본정보 저장
const saveBasicInfo = async (req, res) => {
  const { draftId } = req.params;

  const {
    title,
    shortTitle,
    category,
    mainIngredient,
    subIngredients,
    alcoholPercentage,
    summary,
    thumbnailUrl,
    imageUrls,
    tags,
  } = req.body;

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '입력값이 올바르지 않습니다.',
    });
  }

  if (!category || !title || !mainIngredient || !alcoholPercentage || !summary) {
    return res.status(400).json({
      status: 400,
      message: '필수 기본정보를 모두 입력해야 합니다.',
    });
  }

  if (subIngredients && !Array.isArray(subIngredients)) {
    return res.status(400).json({
      status: 400,
      message: '서브 재료 입력값이 올바르지 않습니다.',
    });
  }

  if (imageUrls && !Array.isArray(imageUrls)) {
    return res.status(400).json({
      status: 400,
      message: '대표 이미지 목록 입력값이 올바르지 않습니다.',
    });
  }

  if (imageUrls && imageUrls.length > 5) {
    return res.status(400).json({
      status: 400,
      message: '대표 이미지는 최대 5개까지 등록할 수 있습니다.',
    });
  }

  if (tags && !Array.isArray(tags)) {
    return res.status(400).json({
      status: 400,
      message: '검색 태그 입력값이 올바르지 않습니다.',
    });
  }

  const normalizedImageUrls = imageUrls || [];
  const normalizedThumbnailUrl =
    normalizedImageUrls.length > 0 ? normalizedImageUrls[0] : thumbnailUrl || null;

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res))) return;

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
        thumbnail_url = $8,
        image_urls = $9,
        tags = $10,
        progress_rate = GREATEST(progress_rate, 33),
        updated_at = CURRENT_TIMESTAMP
      WHERE draft_id = $11
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
        normalizeJsonStorageValue(subIngredients || [], []),
        Number(alcoholPercentage),
        summary,
        normalizedThumbnailUrl,
        normalizeJsonStorageValue(normalizedImageUrls, []),
        normalizeJsonStorageValue(tags || [], []),
        Number(draftId),
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '임시저장 프로젝트를 찾을 수 없습니다.',
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
      message: '기본정보가 저장되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '기본정보 저장 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 목표금액 & 일정 저장
const saveSchedule = async (req, res) => {
  const { draftId } = req.params;

  const {
    pricePerBottle,
    totalQuantity,
    fundingStartDate,
    fundingPeriodDays,
    expectedDeliveryDate,
    platformFeeRate,
    shippingFee,
  } = req.body;

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
      message: '입력값이 올바르지 않습니다.',
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
      message: '가격, 수량, 프로젝트 기간 입력값이 올바르지 않습니다.',
    });
  }

  const startDate = new Date(fundingStartDate);

  if (Number.isNaN(startDate.getTime())) {
    return res.status(400).json({
      status: 400,
      message: '펀딩 시작일 형식이 올바르지 않습니다.',
    });
  }

  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + fundingPeriodDaysNumber);

  const deliveryDate = new Date(expectedDeliveryDate);

  if (Number.isNaN(deliveryDate.getTime())) {
    return res.status(400).json({
      status: 400,
      message: '예상 배송 시작일 형식이 올바르지 않습니다.',
    });
  }

  if (deliveryDate <= endDate) {
    return res.status(400).json({
      status: 400,
      message: '예상 배송 시작일은 펀딩 종료일 이후여야 합니다.',
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
      message: '수수료 또는 배송비 입력값이 올바르지 않습니다.',
    });
  }

  const formatDate = (date) => date.toISOString().slice(0, 10);

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res))) return;

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
        progress_rate = GREATEST(progress_rate, 47),
        updated_at = CURRENT_TIMESTAMP
      WHERE draft_id = $11
      RETURNING
        draft_id,
        price_per_bottle,
        total_quantity,
        target_amount,
        funding_start_date,
        funding_period_days,
        funding_end_date,
        expected_delivery_date,
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
        Number(draftId),
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '임시저장 프로젝트를 찾을 수 없습니다.',
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
        fundingEndDate: draft.funding_end_date,
        expectedDeliveryDate: draft.expected_delivery_date,
        platformFeeRate: draft.platform_fee_rate,
        platformFeeAmount: draft.platform_fee_amount,
        shippingFee: draft.shipping_fee,
      },
      platformFeeRate: draft.platform_fee_rate,
      platformFeeAmount,
      shippingFee: draft.shipping_fee,
      progressRate: draft.progress_rate,
      updatedAt: draft.updated_at,
      message: '목표 금액 및 일정이 저장되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '목표 금액 및 일정 저장 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 법적 고시 정보 저장
const saveLegalInfo = async (req, res) => {
  const { draftId } = req.params;

  const {
    productType,
    volume,
    alcoholPercentage,
    rawMaterials,
  } = req.body;

  if (
    !draftId ||
    isNaN(Number(draftId)) ||
    !productType ||
    volume === undefined ||
    alcoholPercentage === undefined ||
    !Array.isArray(rawMaterials)
  ) {
    return res.status(400).json({
      status: 400,
      message: '법적 고시 정보 입력이 올바르지 않습니다.',
    });
  }

  if (
    Number(volume) <= 0 ||
    Number(alcoholPercentage) <= 0 ||
    Number(alcoholPercentage) > 100
  ) {
    return res.status(400).json({
      status: 400,
      message: '용량 또는 도수 입력값이 올바르지 않습니다.',
    });
  }

  if (rawMaterials.length === 0) {
    return res.status(400).json({
      status: 400,
      message: '최소 1개 이상의 원재료를 입력해야 합니다.',
    });
  }

  const hasInvalidMaterial = rawMaterials.some(
    (material) => !material.name || !material.origin
  );

  if (hasInvalidMaterial) {
    return res.status(400).json({
      status: 400,
      message: '법적 고시 정보 입력이 올바르지 않습니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res))) return;

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
        JSON.stringify(rawMaterials),
        Number(draftId),
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '임시저장 프로젝트를 찾을 수 없습니다.',
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
      rawMaterials: parseJsonField(draft.raw_materials, []),
      progressRate: draft.progress_rate,
      updatedAt: draft.updated_at,
      message: '법적 고시 정보가 저장되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '법적 고시 정보 저장 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 맛지표 저장
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
      message: '맛지표 입력값이 올바르지 않습니다.',
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
      message: '맛지표는 0부터 100 사이의 값이어야 합니다.',
    });
  }

  if (flavorNotes && !Array.isArray(flavorNotes) && typeof flavorNotes !== 'string') {
    return res.status(400).json({
      status: 400,
      message: '맛지표 입력값이 올바르지 않습니다.',
    });
  }

  if (flavorTags && !Array.isArray(flavorTags) && typeof flavorTags !== 'string') {
    return res.status(400).json({
      status: 400,
      message: '留쏆????낅젰媛믪씠 ?щ컮瑜댁? ?딆뒿?덈떎.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res))) return;

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
        message: '임시저장 프로젝트를 찾을 수 없습니다.',
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
      message: '맛지표 정보가 저장되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '맛지표 저장 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 프로젝트 계획 정보 저장 API
const savePlan = async (req, res) => {
  const { draftId } = req.params;
  const bodyPayload = req.body || {};

  const introduction = getBodyValue(bodyPayload, ['introduction', 'projectIntroduction']);
  const videoUrl = getBodyValue(bodyPayload, ['videoUrl', 'video_url']);
  const budgetPlan = getBodyValue(bodyPayload, ['budgetPlan', 'budget_plan', 'projectBudget']);
  const schedulePlan = getBodyValue(bodyPayload, ['schedulePlan', 'schedule_plan', 'projectSchedule']);
  const policy = getBodyValue(bodyPayload, ['policy', 'projectPolicy']);
  const hasIntroduction = hasOwn(bodyPayload, 'introduction') || hasOwn(bodyPayload, 'projectIntroduction');
  const hasVideoUrl = hasOwn(bodyPayload, 'videoUrl') || hasOwn(bodyPayload, 'video_url');
  const hasBudgetPlan = hasOwn(bodyPayload, 'budgetPlan') || hasOwn(bodyPayload, 'budget_plan') || hasOwn(bodyPayload, 'projectBudget');
  const hasSchedulePlan = hasOwn(bodyPayload, 'schedulePlan') || hasOwn(bodyPayload, 'schedule_plan') || hasOwn(bodyPayload, 'projectSchedule');
  const hasPolicy = hasOwn(bodyPayload, 'policy') || hasOwn(bodyPayload, 'projectPolicy');

  if (
    !draftId ||
    isNaN(Number(draftId)) ||
    !(hasIntroduction || hasVideoUrl || hasBudgetPlan || hasSchedulePlan || hasPolicy)
  ) {
    return res.status(400).json({
      status: 400,
      message: '프로젝트 계획 입력값이 올바르지 않습니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res))) return;

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
        message: '임시저장 프로젝트를 찾을 수 없습니다.',
      });
    }

    const draft = result.rows[0];

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
        policy: parseOriginalTextField(draft.refund_policy || draft.exchange_policy),
        projectPolicy: parseOriginalTextField(draft.refund_policy || draft.exchange_policy),
        ...PLAN_GUIDES,
      },
      progressRate: draft.progress_rate,
      updatedAt: draft.updated_at,
      message: '프로젝트 계획 정보가 저장되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '프로젝트 계획 정보 저장 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 창작자/정산/사업자 정보 저장
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
  const contactEmail = toTrimmedString(getBodyValue(body, ['contactEmail', 'contact_email']));
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
  const businessType = getBodyValue(body, ['businessType', 'business_type']);
  const businessName = getBodyValue(body, ['businessName', 'business_name']);
  const businessCategory = getBodyValue(body, ['businessCategory', 'business_category']);
  const businessItem = getBodyValue(body, ['businessItem', 'business_item']);
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
      message: '양조장 정보 입력값이 올바르지 않습니다.',
    });
  }

  const normalizedBusinessNumber = businessRegistrationNumber.replace(/\D/g, '');
  const normalizedPhone = contactPhone.replace(/\D/g, '');

  if (!/^\d{10}$/.test(normalizedBusinessNumber)) {
    return res.status(400).json({
      status: 400,
      message: '사업자등록번호 형식이 올바르지 않습니다.',
    });
  }

  if (!/^01\d{8,9}$/.test(normalizedPhone)) {
    return res.status(400).json({
      status: 400,
      message: '전화번호 형식이 올바르지 않습니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res))) return;

    let resolvedAccountVerified = accountVerified;

    if (bankVerificationToken) {
      const verificationResult = await pool.query(
        `
        SELECT verification_id
        FROM funding_bank_account_verifications
        WHERE verification_token = $1
          AND status = 'VERIFIED'
          AND bank_name = $2
          AND regexp_replace(account_number, '[[:space:]-]', '', 'g') = $3
          AND account_holder = $4
        LIMIT 1
        `,
        [
          bankVerificationToken,
          bankName,
          normalizeComparableAccountNumber(accountNumber),
          accountHolder,
        ]
      );

      if (verificationResult.rows.length === 0) {
        return res.status(400).json({
          status: 400,
          message: '계좌 인증 토큰이 올바르지 않습니다.',
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
        contact_email = $5,
        contact_phone = $6,
        bank_name = $7,
        account_number = $8,
        account_holder = $9,
        profile_image_url = $10,
        creator_introduction = $11,
        business_type = $12,
        business_name = $13,
        business_category = $14,
        business_item = $15,
        phone_verified = $16,
        account_verified = $17,
        creator_name = COALESCE(creator_name, $1),
        progress_rate = GREATEST(progress_rate, 85),
        updated_at = CURRENT_TIMESTAMP
      WHERE draft_id = $18
      RETURNING *
      `,
      [
        breweryName,
        representativeName,
        businessRegistrationNumber,
        businessAddress,
        contactEmail,
        contactPhone,
        bankName,
        accountNumber,
        accountHolder,
        breweryProfileImageUrl || null,
        breweryBio || null,
        businessType || null,
        businessName || breweryName,
        businessCategory || null,
        businessItem || null,
        phoneVerified,
        resolvedAccountVerified,
        Number(draftId),
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '임시저장 프로젝트를 찾을 수 없습니다.',
      });
    }

    const draft = result.rows[0];

    return res.status(200).json({
      draftId: draft.draft_id,
      section: 'BREWERY_INFO',
      breweryName: draft.brewery_name,
      representativeName: draft.representative_name,
      businessRegistrationNumber: draft.business_registration_number,
      businessAddress: draft.business_address,
      contactEmail: draft.contact_email,
      contactPhone: draft.contact_phone,
      bankName: draft.bank_name,
      accountNumber: draft.account_number,
      accountHolder: draft.account_holder,
      breweryProfileImageUrl: draft.profile_image_url,
      breweryBio: draft.creator_introduction,
      creatorIntroduction: draft.creator_introduction,
      businessType: draft.business_type,
      businessName: draft.business_name,
      businessCategory: draft.business_category,
      businessItem: draft.business_item,
      phoneVerified: draft.phone_verified,
      accountVerified: draft.account_verified,
      progressRate: draft.progress_rate,
      updatedAt: draft.updated_at,
      message: '창작자/정산/사업자 정보가 저장되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '창작자/정산/사업자 정보 저장 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 프젝생성 추가1: 양조장 정보 불러오기
const loadBreweryInfo = async (req, res) => {
  const { draftId } = req.params;

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '임시저장 프로젝트 ID가 올바르지 않습니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res))) return;

    const result = await pool.query(
      `
      SELECT
        fd.brewery_id,
        fd.brewery_name,
        creator_name,
        profile_image_url,
        creator_introduction,
        business_name,
        business_registration_number,
        representative_name,
        business_address,
        contact_email,
        contact_phone,
        bank_name,
        account_number,
        account_holder,
        phone_verified,
        account_verified,
        business_type,
        business_category,
        business_item,
        tax_email,
        identity_document_url,
        business_registration_file_url,
        ba.brewery_name AS approved_brewery_name,
        ba.location AS approved_brewery_location,
        ba.license_number AS approved_license_number,
        ba.business_address_detail AS approved_business_address_detail,
        ba.phone_number AS approved_phone_number,
        ba.document_url AS approved_document_url,
        ba.document_key AS approved_document_key,
        ba.original_name AS approved_document_original_name,
        ba.mime_type AS approved_document_mime_type,
        ba.file_size AS approved_document_file_size,
        ba.status AS approved_application_status,
        u.nickname AS user_nickname,
        u.email AS user_email,
        u.phone_number AS user_phone_number,
        u.profile_image AS user_profile_image
      FROM funding_drafts fd
      LEFT JOIN users u ON u.user_id = fd.brewery_id
      LEFT JOIN LATERAL (
        SELECT
          brewery_name,
          location,
          license_number,
          business_address_detail,
          phone_number,
          document_url,
          document_key,
          original_name,
          mime_type,
          file_size,
          status
        FROM brewery_auth
        WHERE user_id = fd.brewery_id
        ORDER BY
          CASE WHEN status = 'APPROVED' THEN 0 ELSE 1 END,
          updated_at DESC,
          application_id DESC
        LIMIT 1
      ) ba ON TRUE
      WHERE fd.draft_id = $1
      `,
      [Number(draftId)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '임시저장 프로젝트를 찾을 수 없습니다.',
      });
    }

    const info = result.rows[0];

    return res.status(200).json({
      breweryInfo: {
        breweryId: info.brewery_id,
        breweryName: info.brewery_name || info.approved_brewery_name || info.user_nickname,
        creatorName: info.creator_name || info.brewery_name || info.approved_brewery_name || info.user_nickname,
        profileImageUrl: info.profile_image_url || info.user_profile_image,
        creatorIntroduction: info.creator_introduction,
        breweryBio: info.creator_introduction,
        businessName: info.business_name || info.brewery_name || info.approved_brewery_name,
        businessRegistrationNumber: info.business_registration_number || info.approved_license_number,
        representativeName: info.representative_name,
        businessAddress: info.business_address || info.approved_brewery_location,
        businessAddressDetail: info.approved_business_address_detail || null,
        contactEmail: info.contact_email || info.user_email,
        contactPhone: info.contact_phone || info.approved_phone_number || info.user_phone_number,
        bankName: info.bank_name,
        accountNumber: info.account_number,
        accountHolder: info.account_holder,
        phoneVerified: info.phone_verified,
        accountVerified: info.account_verified,
        businessType: info.business_type,
        businessCategory: info.business_category,
        businessItem: info.business_item,
        taxEmail: info.tax_email,
        identityDocumentUrl: info.identity_document_url,
        businessRegistrationFileUrl: info.business_registration_file_url || info.approved_document_url,
        businessLicense: info.approved_document_url
          ? {
              documentUrl: info.approved_document_url,
              documentKey: info.approved_document_key,
              originalName: info.approved_document_original_name,
              mimeType: info.approved_document_mime_type,
              fileSize: info.approved_document_file_size === null || info.approved_document_file_size === undefined
                ? null
                : Number(info.approved_document_file_size),
            }
          : null,
        applicationStatus: info.approved_application_status || null,
      },
      missingFields: [
        ...(!(info.creator_name || info.brewery_name || info.approved_brewery_name || info.user_nickname) ? ['creatorName'] : []),
        ...(!(info.contact_phone || info.approved_phone_number || info.user_phone_number) ? ['phoneNumber'] : []),
        ...(!(info.business_registration_number || info.approved_license_number) ? ['businessNumber'] : []),
        ...(!(info.business_address || info.approved_brewery_location) ? ['businessAddress'] : []),
        ...(!info.representative_name ? ['representativeName'] : []),
        ...(!(info.business_registration_file_url || info.approved_document_url) ? ['businessLicense'] : []),
        ...(!info.creator_introduction ? ['creatorIntroduction'] : []),
      ],
      message: '양조장 정보를 불러왔습니다. 본인 인증과 입금 계좌는 직접 입력해주세요.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '양조장 정보 불러오기 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
//프젝생성 추가2: 펀딩 프로젝트 파일 업로드:이미지,신분증,사업자등록증 파일을 한 API에서 처리
const uploadFundingDraftFile = async (req, res) => {
  const { draftId } = req.params;
  const { fileType } = req.body;
  const file = req.file;

  const allowedFileTypes = [
    'PROFILE_IMAGE',
    'IDENTITY_DOCUMENT',
    'BUSINESS_REGISTRATION',
  ];

  if (!draftId || isNaN(Number(draftId)) || !fileType) {
    return res.status(400).json({
      status: 400,
      message: '파일 업로드 요청값이 올바르지 않습니다.',
    });
  }

  if (!allowedFileTypes.includes(fileType)) {
    return res.status(400).json({
      status: 400,
      message: '지원하지 않는 파일 유형입니다.',
    });
  }

  if (!file) {
    return res.status(400).json({
      status: 400,
      message: '업로드할 파일이 필요합니다.',
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
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res))) return;

    const fileUrl = await storeUploadedFile(file, `funding-drafts/${draftId}`, draftId);

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
        message: '임시저장 프로젝트를 찾을 수 없습니다.',
      });
    }

    return res.status(201).json({
      draftId: result.rows[0].draft_id,
      fileType,
      fileUrl,
      updatedAt: result.rows[0].updated_at,
      message: '파일이 업로드되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '파일 업로드 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
//프젝생성 추가3: 휴대폰 본인 인증 API
const verifyPhoneForFundingDraft = async (req, res) => {
  const { draftId } = req.params;
  const { contactPhone } = req.body;

  if (!draftId || isNaN(Number(draftId)) || !contactPhone) {
    return res.status(400).json({
      status: 400,
      message: '휴대폰 인증 요청값이 올바르지 않습니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res))) return;

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
        message: '임시저장 프로젝트를 찾을 수 없습니다.',
      });
    }

    const draft = result.rows[0];

    return res.status(200).json({
      draftId: draft.draft_id,
      contactPhone: draft.contact_phone,
      phoneVerified: draft.phone_verified,
      updatedAt: draft.updated_at,
      message: '휴대폰 본인 인증이 완료되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '휴대폰 인증 처리 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
//프젝생성 추가4: 입금계좌 인증처리
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
  const resolvedBankVerificationToken = toTrimmedString(
    bankVerificationToken
    || snakeBankVerificationToken
    || accountVerificationToken
    || snakeAccountVerificationToken
  );

  if (
    !draftId ||
    isNaN(Number(draftId)) ||
    !bankName ||
    !accountNumber ||
    !accountHolder ||
    !resolvedBankVerificationToken
  ) {
    return res.status(400).json({
      status: 400,
      message: '계좌 인증 요청값이 올바르지 않습니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res))) return;

    const verificationResult = await pool.query(
      `
      SELECT verification_id
      FROM funding_bank_account_verifications
      WHERE verification_token = $1
        AND status = 'VERIFIED'
        AND bank_name = $2
        AND regexp_replace(account_number, '[[:space:]-]', '', 'g') = $3
        AND account_holder = $4
      LIMIT 1
      `,
      [
        resolvedBankVerificationToken,
        bankName,
        normalizeComparableAccountNumber(accountNumber),
        accountHolder,
      ]
    );

    if (verificationResult.rows.length === 0) {
      return res.status(400).json({
        status: 400,
        message: '계좌 인증 토큰이 올바르지 않습니다.',
      });
    }

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
      [bankName, accountNumber, accountHolder, Number(draftId)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '임시저장 프로젝트를 찾을 수 없습니다.',
      });
    }

    const draft = result.rows[0];

    return res.status(200).json({
      draftId: draft.draft_id,
      bankName: draft.bank_name,
      accountNumber: draft.account_number,
      accountHolder: draft.account_holder,
      accountVerified: draft.account_verified,
      updatedAt: draft.updated_at,
      message: '입금 계좌 인증이 완료되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '계좌 인증 처리 중 서버 오류가 발생했습니다.',
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
      message: '계좌 인증 요청값이 올바르지 않습니다.',
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
      response.devMessage = '실제 1원 송금 제공사 연동 전까지 개발/로컬 확인용 인증번호입니다.';
    }

    return res.status(201).json(response);
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '계좌 인증 요청 생성 중 서버 오류가 발생했습니다.',
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
      message: '계좌 인증 확인 요청값이 올바르지 않습니다.',
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
        AND regexp_replace(account_number, '[[:space:]-]', '', 'g') = $2
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
        message: '계좌 인증 요청을 찾을 수 없거나 만료되었습니다.',
      });
    }

    const verification = verificationResult.rows[0];

    if (verification.verification_code !== verificationCode) {
      return res.status(400).json({
        status: 400,
        message: '계좌 인증번호가 올바르지 않습니다.',
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
      message: '계좌 인증이 완료되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '계좌 인증 확인 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 환불/교환/성인인증/리스크 안내 저장
const saveNotices = async (req, res) => {
  const { draftId } = req.params;
  const bodyPayload = req.body || {};

  const {
    refundPolicy,
    exchangePolicy,
    policy,
    projectPolicy,
    adultVerificationNotice,
    riskNotice,
  } = bodyPayload;
  const normalizedPolicy = policy ?? projectPolicy;
  const normalizedRefundPolicy = refundPolicy ?? normalizedPolicy;
  const normalizedExchangePolicy = exchangePolicy ?? normalizedPolicy;

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '안내사항 입력값이 올바르지 않습니다.',
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
      message: '필수 안내사항을 모두 입력해야 합니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res))) return;

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
        message: '임시저장 프로젝트를 찾을 수 없습니다.',
      });
    }

    const draft = result.rows[0];

    return res.status(200).json({
      draftId: draft.draft_id,
      section: 'NOTICES',
      policy: parseOriginalTextField(draft.refund_policy || draft.exchange_policy),
      projectPolicy: parseOriginalTextField(draft.refund_policy || draft.exchange_policy),
      refundPolicy: parseOriginalTextField(draft.refund_policy),
      exchangePolicy: parseOriginalTextField(draft.exchange_policy),
      adultVerificationNotice: draft.adult_verification_notice,
      riskNotice: draft.risk_notice,
      progressRate: draft.progress_rate,
      updatedAt: draft.updated_at,
      message: '안내사항 정보가 저장되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '안내사항 저장 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 필수 서류 업로드
const uploadDocument = async (req, res) => {
  const { draftId } = req.params;
  const { documentType } = req.body || {};
  const file = req.file;
  const normalizedDocumentType = normalizeFundingDocumentType(documentType);

  if (!draftId || isNaN(Number(draftId)) || !documentType) {
    return res.status(400).json({
      status: 400,
      message: '서류 업로드 요청값이 올바르지 않습니다.',
    });
  }

  if (!normalizedDocumentType) {
    return res.status(400).json({
      status: 400,
      message: '서류 업로드 요청값이 올바르지 않습니다.',
    });
  }

  if (!file) {
    return res.status(400).json({
      status: 400,
      message: '업로드할 파일이 필요합니다.',
    });
  }

  const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png'];

  if (!allowedMimeTypes.includes(file.mimetype)) {
    return res.status(400).json({
      status: 400,
      message: '지원하지 않는 파일 형식입니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res))) return;

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

    const document = result.rows[0];

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
      message: isAllRequiredDocumentsUploaded
        ? '필수 서류가 모두 업로드되어 프로젝트 작성이 100% 완료되었습니다.'
        : '필수 서류가 업로드되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '필수 서류 업로드 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

//펀딩프로젝트 제출 (새로 추가!!)
// 펀딩 프로젝트 제출 + 실제 펀딩 게시글 생성
const submitFundingDraft = async (req, res) => {
  const { draftId } = req.params;

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '제출 요청값이 올바르지 않습니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res))) return;

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
        message: '임시저장 프로젝트를 찾을 수 없습니다.',
      });
    }

    const draft = draftResult.rows[0];

    if (draft.status === 'SUBMITTED') {
      return res.status(400).json({
        status: 400,
        message: '이미 제출된 프로젝트입니다.',
      });
    }

    if (Number(draft.progress_rate) < 100) {
      return res.status(400).json({
        status: 400,
        message: '필수 정보를 모두 입력한 후 제출할 수 있습니다.',
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
        message: '필수 인증 서류를 모두 업로드해야 제출할 수 있습니다.',
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
          message: '양조장 사용자 정보가 없어 제출할 수 없습니다.',
        });
      }

      /**
       * 현재 funding_projects 테이블 기준으로 필요한 최소 필드만 생성
       * 네 기존 목록/상세 API가 funding_projects + recipes를 JOIN하고 있어서
       * 임시 recipe도 같이 생성해준다.
       */
      const recipeResult = await client.query(
        `
        INSERT INTO recipes (
          user_id,
          title,
          content,
          abv_range,
          main_ingredient,
          ai_sub_ingredient,
          target_flavor,
          concept,
          summary,
          author_type,
          status,
          is_fundable,
          image_url,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, 'BREWERY', 'PUBLISHED', TRUE, $10,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        RETURNING recipe_id
        `,
        [
          breweryUserId,
          draft.title,
          draft.introduction || draft.summary || '',
          `${draft.alcohol_percentage || 0}%`,
          draft.main_ingredient || null,
          normalizeJsonStorageValue(draft.sub_ingredients, []),
          normalizeJsonStorageValue(draft.flavor_notes, []),
          draft.category || null,
          draft.summary || '',
          draft.thumbnail_url || null,
        ]
      );

      const recipeId = recipeResult.rows[0].recipe_id;

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
          normalizeJsonStorageValue(draft.image_urls, []),
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

      return res.status(200).json({
        draftId: submittedDraft.draft_id,
        fundingId: funding.funding_id,
        recipeId,
        status: submittedDraft.status,
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
        message: '펀딩 프로젝트가 제출되었고 심사 중 게시글이 생성되었습니다.',
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
      message: '펀딩 프로젝트 제출 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 임시저장 단건 조회
const getFundingDraft = async (req, res) => {
  const { draftId } = req.params;

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '임시저장 조회 요청값이 올바르지 않습니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res))) return;

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
        message: '임시저장 프로젝트를 찾을 수 없습니다.',
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
      message: '임시저장 프로젝트 조회 성공',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '임시저장 프로젝트 조회 중 서버 오류가 발생했습니다.',
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

    const draft = await findAndLinkFundingDraftByFundingId(resolvedFundingId);

    if (!draft) {
      return res.status(404).json({
        status: 404,
        message: '연결된 임시저장 프로젝트를 찾을 수 없습니다.',
      });
    }

    const documents = await getFundingDraftDocuments(draft.draft_id);
    const payload = buildFundingDraftPayload(draft, documents);

    return res.status(200).json({
      status: 200,
      message: '연결된 임시저장 프로젝트 조회 성공',
      data: {
        ...payload,
        draft,
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '펀딩 프로젝트 관리 데이터 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 임시저장 목록 조회
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
      message: '양조장 ID가 올바르지 않습니다.',
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
      message: '임시저장 목록 조회 성공',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '임시저장 목록 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 임시저장 삭제
const deleteFundingDraft = async (req, res) => {
  const { draftId } = req.params;

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '임시저장 삭제 요청값이 올바르지 않습니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res))) return;

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
        message: '임시저장 프로젝트를 찾을 수 없습니다.',
      });
    }

    return res.status(200).json({
      draftId: result.rows[0].draft_id,
      message: '임시저장 프로젝트가 삭제되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '임시저장 삭제 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 프로젝트 미리보기
const getFundingDraftPreview = async (req, res) => {
  const { draftId } = req.params;

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '미리보기 요청값이 올바르지 않습니다.',
    });
  }

  try {
    if (!(await authorizeFundingDraftOwner(draftId, req.user, res))) return;

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
        message: '임시저장 프로젝트를 찾을 수 없습니다.',
      });
    }

    const documentResult = await pool.query(
      `
      SELECT
        document_id,
        document_type,
        file_name,
        file_url,
        mime_type,
        file_size,
        created_at
      FROM funding_documents
      WHERE draft_id = $1
      ORDER BY document_id ASC
      `,
      [Number(draftId)]
    );

    const payload = buildFundingDraftPayload(draftResult.rows[0], documentResult.rows);

    return res.status(200).json({
      ...payload,
      message: '프로젝트 미리보기 조회 성공',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '프로젝트 미리보기 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 공개된 펀딩 프로젝트 수정
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
      message: '잘못된 요청입니다.',
    });
  }

  const allowedStatuses = ['ONGOING', 'ACTIVE', 'ENDED', 'CANCELLED'];

  if (status && !allowedStatuses.includes(status)) {
    return res.status(400).json({
      status: 400,
      message: '펀딩 상태값이 올바르지 않습니다.',
    });
  }

  if (
    goalAmount !== undefined &&
    (!Number.isInteger(Number(goalAmount)) || Number(goalAmount) < 0)
  ) {
    return res.status(400).json({
      status: 400,
      message: '목표 금액 입력값이 올바르지 않습니다.',
    });
  }

  if (
    pricePerBottle !== undefined &&
    (!Number.isInteger(Number(pricePerBottle)) || Number(pricePerBottle) <= 0)
  ) {
    return res.status(400).json({
      status: 400,
      message: '병당 가격 입력값이 올바르지 않습니다.',
    });
  }

  if (
    shippingFee !== undefined &&
    (!Number.isInteger(Number(shippingFee)) || Number(shippingFee) < 0)
  ) {
    return res.status(400).json({
      status: 400,
      message: '배송비 입력값이 올바르지 않습니다.',
    });
  }

  if (imageUrls !== undefined && !Array.isArray(imageUrls)) {
    return res.status(400).json({
      status: 400,
      message: '????대?吏 紐⑸줉 ?낅젰媛믪씠 ?щ컮瑜댁? ?딆뒿?덈떎.',
    });
  }

  if (imageUrls && imageUrls.length > 5) {
    return res.status(400).json({
      status: 400,
      message: '????대?吏??理쒕? 5媛쒓퉴吏 ?깅줉?????덉뒿?덈떎.',
    });
  }

  const normalizedImageFields = imageUrls !== undefined || thumbnailUrl !== undefined
    ? buildImageFields(thumbnailUrl, imageUrls || [])
    : null;

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
        thumbnail_url = COALESCE($9, thumbnail_url),
        image_urls = COALESCE($10, image_urls)
      WHERE funding_id = $11
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
        normalizedImageFields ? normalizedImageFields.thumbnailUrl : null,
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
      message: '펀딩 프로젝트가 수정되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '펀딩 프로젝트 수정 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩프로젝트 목록 조회
const mapFundingListRow = (row) => {
  const currentAmount = Number(row.current_amount || 0);
  const targetAmount = Number(row.target_amount || 0);
  const imageFields = buildImageFields(row.thumbnail_url, row.image_urls);
  const breweryUserId =
    row.brewery_user_id === null || row.brewery_user_id === undefined
      ? null
      : Number(row.brewery_user_id);

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
    matchRate: row.match_rate === null || row.match_rate === undefined ? null : Number(row.match_rate),
    sulbtiMatchScore: row.match_rate === null || row.match_rate === undefined ? null : Number(row.match_rate),
    matchScore: row.match_rate === null || row.match_rate === undefined ? null : Number(row.match_rate),
    tasteMatchScore: row.match_rate === null || row.match_rate === undefined ? null : Number(row.match_rate),
    recommendationScore: row.match_rate === null || row.match_rate === undefined ? null : Number(row.match_rate),
    matchPercent: row.match_rate === null || row.match_rate === undefined ? null : Number(row.match_rate),
    liked: row.liked,
    likeCount: Number(row.like_count || 0),
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
    : 'ID_ASC';
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
      message: '잘못된 요청 파라미터입니다.',
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

  const values = [];
  const conditions = [];

  if (normalizedStatus) {
    values.push(normalizedStatus);
    conditions.push(`fp.status = $${values.length}`);
  }

  if (normalizedKeyword) {
    values.push(`%${normalizedKeyword}%`);
    const keywordParam = `$${values.length}`;
    conditions.push(`(
      fp.title ILIKE ${keywordParam}
      OR COALESCE(fp.description, '') ILIKE ${keywordParam}
      OR COALESCE(ba.brewery_name, u.nickname, '') ILIKE ${keywordParam}
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
    JOIN recipes r ON r.recipe_id = fp.recipe_id
    JOIN users u ON u.user_id = fp.brewery_user_id
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
        ORDER BY created_at DESC
        LIMIT 1
      ) sb_match ON TRUE
      LEFT JOIN users requester ON requester.user_id = ${userIdParam}
    `;
    const orderBy = {
      RECOMMENDED: 'ORDER BY match_rate DESC NULLS LAST, fp.created_at DESC',
      POPULAR: 'ORDER BY like_counts.like_count DESC, fp.created_at DESC',
      LATEST: 'ORDER BY fp.created_at DESC',
      DEADLINE: 'ORDER BY CASE WHEN fp.end_date >= CURRENT_DATE THEN 0 ELSE 1 END, fp.end_date ASC, fp.created_at DESC',
      ID_ASC: 'ORDER BY fp.funding_id ASC',
    }[normalizedSort];

    const { rows } = await pool.query(
      `
      SELECT
        fp.funding_id,
        fp.brewery_user_id,
        fp.title,
        fp.description,
        COALESCE(ba.brewery_name, u.nickname) AS brewery_name,
        r.title AS recipe_title,
        COALESCE(fp.thumbnail_url, r.image_url) AS thumbnail_url,
        fp.image_urls,
        fp.status,
        fp.current_amount,
        fp.goal_amount AS target_amount,
        fp.start_date,
        fp.end_date,
        fp.expected_delivery_date,
        fp.price_per_bottle,
        fp.shipping_fee,
        COALESCE(like_counts.like_count, 0) AS like_count,
        CASE
          WHEN requester.taste_vector IS NOT NULL AND tp_match.taste_profile_id IS NOT NULL THEN ROUND((
            (100 - ABS((
              CASE
                WHEN ((requester.taste_vector->>'sweetness')::numeric) <= 10
                  THEN ((requester.taste_vector->>'sweetness')::numeric) * 10
                ELSE ((requester.taste_vector->>'sweetness')::numeric)
              END
            ) - COALESCE(tp_match.sweetness, 50))) +
            (100 - ABS((
              CASE
                WHEN ((requester.taste_vector->>'body')::numeric) <= 10
                  THEN ((requester.taste_vector->>'body')::numeric) * 10
                ELSE ((requester.taste_vector->>'body')::numeric)
              END
            ) - COALESCE(tp_match.body, 50))) +
            (100 - ABS((
              CASE
                WHEN ((requester.taste_vector->>'carbonation')::numeric) <= 10
                  THEN ((requester.taste_vector->>'carbonation')::numeric) * 10
                ELSE ((requester.taste_vector->>'carbonation')::numeric)
              END
            ) - COALESCE(tp_match.carbonation, 50))) +
            (100 - ABS((
              CASE
                WHEN ((requester.taste_vector->>'alcohol')::numeric) <= 10
                  THEN ((requester.taste_vector->>'alcohol')::numeric) * 10
                ELSE ((requester.taste_vector->>'alcohol')::numeric)
              END
            ) - COALESCE(tp_match.alcohol_intensity, 50))) +
            (100 - ABS((
              CASE
                WHEN ((requester.taste_vector->>'acidity')::numeric) <= 10
                  THEN ((requester.taste_vector->>'acidity')::numeric) * 10
                ELSE ((requester.taste_vector->>'acidity')::numeric)
              END
            ) - COALESCE(tp_match.acidity, 50)))
          ) / 5.0)::int
          WHEN sb_match.result_id IS NOT NULL AND tp_match.taste_profile_id IS NOT NULL THEN ROUND((
            (100 - ABS(((sb_match.sweetness_score - 1) * 25) - COALESCE(tp_match.sweetness, 50))) +
            (100 - ABS(((sb_match.body_score - 1) * 25) - COALESCE(tp_match.body, 50))) +
            (100 - ABS(((sb_match.carbonation_score - 1) * 25) - COALESCE(tp_match.carbonation, 50))) +
            (100 - ABS(((sb_match.abv_score - 1) * 25) - COALESCE(tp_match.alcohol_intensity, 50)))
          ) / 4.0)::int
          ELSE NULL
        END AS match_rate,
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

    return res.status(200).json({
      status: 200,
      message: '펀딩 목록 조회 성공',
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
      message: '서버 내부 오류',
      error: error.message,
    });
  }
};

const getFundingStats = async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        (
          SELECT COUNT(*)::int
          FROM funding_projects
          WHERE status IN ('ONGOING', 'ACTIVE')
          AND (end_date IS NULL OR end_date >= CURRENT_DATE)
        ) AS available_funding_count,
        (
          SELECT COUNT(DISTINCT user_id)::int
          FROM orders
          WHERE order_status = 'PAID'
        ) AS total_supporter_count,
        (
          SELECT COUNT(*)::int
          FROM funding_projects
          WHERE goal_amount > 0
          AND current_amount >= goal_amount
        ) AS successful_project_count,
        (
          SELECT COALESCE(SUM(current_amount), 0)::bigint
          FROM funding_projects
        ) AS total_raised_amount
      `
    );

    const stats = result.rows[0];
    const totalRaisedAmount = Number(stats.total_raised_amount || 0);

    return res.status(200).json({
      participationAvailableFunding: Number(stats.available_funding_count || 0),
      totalSupporterCount: Number(stats.total_supporter_count || 0),
      successfulProjectCount: Number(stats.successful_project_count || 0),
      totalRaisedAmount,
      totalRaisedHundredMillion: Number((totalRaisedAmount / 100000000).toFixed(1)),
      totalRaisedTenMillion: Number((totalRaisedAmount / 10000000).toFixed(1)),
      totalRaisedTenMillionUnit: '천만원',
      message: '펀딩 통계 조회 성공',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '펀딩 통계 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 펀딩 프로젝트 상세조회
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

    const fundingResult = await pool.query(
      `
      SELECT
        fp.funding_id,
        fp.title,
        fp.description,
        COALESCE(fd.summary, fp.summary) AS summary,
        COALESCE(fd.category, fp.category) AS category,
        COALESCE(NULLIF(fd.image_urls::text, '[]'), NULLIF(fp.image_urls::text, '[]')) AS image_urls,
        fp.status,
        fp.current_amount,
        COALESCE(fd.target_amount, fp.goal_amount) AS target_amount,
        COALESCE(fd.funding_start_date, fp.start_date) AS start_date,
        COALESCE(fd.funding_end_date, fp.end_date) AS end_date,
        COALESCE(fd.expected_delivery_date, fp.expected_delivery_date) AS expected_delivery_date,
        COALESCE(fd.price_per_bottle, fp.price_per_bottle) AS price_per_bottle,
        COALESCE(fd.shipping_fee, fp.shipping_fee) AS shipping_fee,
        fd.total_quantity,
        COALESCE(fd.volume, fp.volume) AS volume,
        COALESCE(fd.alcohol_percentage, fp.alcohol_percentage) AS alcohol_percentage,
        fp.bottle_size,
        fp.created_at,
        fd.draft_id,
        fd.short_title,
        fd.main_ingredient,
        fd.sub_ingredients,
        fd.tags,
        fd.sweetness,
        fd.acidity,
        fd.body,
        fd.carbonation,
        fd.alcohol_intensity,
        fd.flavor_notes,
        fd.product_type,
        fd.raw_materials,
        fd.introduction,
        fd.video_url,
        fd.budget_plan,
        fd.schedule_plan,
        fd.refund_policy,
        fd.exchange_policy,
        fd.adult_verification_notice,
        fd.risk_notice,
        fd.brewery_name AS draft_brewery_name,
        fd.creator_name,
        fd.profile_image_url,
        fd.creator_introduction,
        fd.representative_name,
        COALESCE(NULLIF(fd.business_registration_number, ''), ba.license_number) AS business_registration_number,
        COALESCE(NULLIF(fd.business_address, ''), ba.location) AS business_address,
        COALESCE(NULLIF(fd.business_address_detail, ''), ba.business_address_detail) AS business_address_detail,
        fd.contact_email,
        COALESCE(NULLIF(fd.contact_phone, ''), ba.phone_number) AS contact_phone,
        fd.bank_name,
        fd.account_number,
        fd.account_holder,
        fd.business_type,
        fd.business_name,
        fd.business_category,
        fd.business_item,
        fd.tax_email,
        fd.phone_verified,
        fd.account_verified,
        fd.identity_document_url,
        COALESCE(NULLIF(fd.business_registration_file_url, ''), ba.document_url) AS business_registration_file_url,
        COALESCE(ba.brewery_name, u.nickname) AS brewery_name,
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
      LEFT JOIN LATERAL (
        SELECT *
        FROM funding_drafts fd_inner
        WHERE fd_inner.funding_id = fp.funding_id
        ORDER BY updated_at DESC
        LIMIT 1
      ) fd ON TRUE
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
    const mainIngredient = funding.main_ingredient || null;
    const subIngredients = parseFundingListField(funding.sub_ingredients);
    const ingredients = [mainIngredient, ...subIngredients].filter(Boolean);
    const rawMaterials = parseJsonField(funding.raw_materials);

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
    const totalQuantity = funding.total_quantity ?? (supportOptionStockTotal > 0 ? supportOptionStockTotal : null);

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
      ORDER BY created_at DESC
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
    const refundPolicy = parseOriginalTextField(funding.refund_policy);
    const exchangePolicy = parseOriginalTextField(funding.exchange_policy);
    const projectPolicy = refundPolicy ?? exchangePolicy;
    const tasteProfile = taste
      ? buildTasteProfileResponse({
          ...taste,
          alcohol_percentage: funding.alcohol_percentage,
        })
      : null;

    return res.status(200).json({
      fundingId: Number(funding.funding_id),
      title: funding.title,
      summary: funding.summary || funding.description,
      description: funding.description,
      category: funding.category,
      shortTitle: funding.short_title,
      mainIngredient,
      primaryIngredient: mainIngredient,
      subIngredient: subIngredients[0] || null,
      subIngredients,
      ingredients,
      tags: parseJsonField(funding.tags),
      thumbnailUrl: imageFields.thumbnailUrl,
      imageUrls: imageFields.imageUrls,
      allImageUrls: imageFields.allImageUrls,
      images: mapFundingImageUrls(imageFields.allImageUrls),
      breweryName: funding.draft_brewery_name || funding.brewery_name,
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
      businessAddress: funding.business_address,
      breweryAddress: funding.business_address,
      breweryLocation: funding.business_address,
      matchRate: matchScore,
      sulbtiMatchScore: matchScore,
      matchScore,
      tasteMatchScore: matchScore,
      liked: funding.liked,
      likeCount: Number(funding.like_count || 0),
      tasteProfile,
      legalInfo: {
        productType: funding.product_type,
        volume: funding.volume,
        alcoholPercentage: funding.alcohol_percentage,
        mainIngredient,
        primaryIngredient: mainIngredient,
        subIngredient: subIngredients[0] || null,
        subIngredients,
        ingredients,
        rawMaterials,
        businessNumber: funding.business_registration_number,
        licenseNumber: funding.business_registration_number,
        businessAddress: funding.business_address,
        businessAddressDetail: funding.business_address_detail,
        notice: funding.adult_verification_notice || funding.risk_notice || null,
        policy: projectPolicy,
        refundPolicy,
        exchangePolicy,
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
      breweryInfo: {
        breweryName: funding.draft_brewery_name || funding.brewery_name,
        creatorName: funding.creator_name,
        profileImageUrl: funding.profile_image_url,
        creatorIntroduction: funding.creator_introduction,
        breweryBio: funding.creator_introduction,
        representativeName: funding.representative_name,
        businessRegistrationNumber: funding.business_registration_number,
        businessAddress: funding.business_address,
        businessAddressDetail: funding.business_address_detail,
        breweryLocation: funding.business_address,
        breweryAddress: funding.business_address,
        contactEmail: funding.contact_email,
        contactPhone: funding.contact_phone,
        bankName: funding.bank_name,
        accountNumber: funding.account_number,
        accountHolder: funding.account_holder,
        businessType: funding.business_type,
        businessName: funding.business_name,
        businessCategory: funding.business_category,
        businessItem: funding.business_item,
        taxEmail: funding.tax_email,
        phoneVerified: funding.phone_verified,
        accountVerified: funding.account_verified,
        identityDocumentUrl: funding.identity_document_url,
        businessRegistrationFileUrl: funding.business_registration_file_url,
      },
      notices: {
        refundPolicy,
        exchangePolicy,
        adultVerificationNotice: funding.adult_verification_notice,
        riskNotice: funding.risk_notice,
        notice: funding.adult_verification_notice || funding.risk_notice || null,
        policy: projectPolicy,
      },
      documents: documentResult.rows.map(mapFundingDocument),
      supportOptions: optionResult.rows.map((option) => ({
        optionId: Number(option.option_id),
        name: option.name,
        price: Number(option.price),
        description: option.description,
        volume: option.volume,
        alcohol: option.alcohol,
        stock: option.stock,
        remainingStock: option.remaining_stock,
        maxPerUser: option.max_per_user,
      })),
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '펀딩 상세 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

//프로젝트 소개 조회
const getFundingIntro = async (req, res) => {
  const { fundingId } = req.params;
  const resolvedFundingId = await resolveFundingId(fundingId);

  // 유효성 검증
  if (!resolvedFundingId) {
    return res.status(404).json({
      status: 404,
      message: '프로젝트를 찾을 수 없습니다.',
    });
  }

  try {
    await findAndLinkFundingDraftByFundingId(resolvedFundingId);

    const result = await pool.query(
      `
      SELECT
        fp.funding_id,
        fp.title,
        fp.description,
        fp.summary,
        COALESCE(NULLIF(fd.thumbnail_url, ''), NULLIF(fp.thumbnail_url, '')) AS thumbnail_url,
        COALESCE(NULLIF(fd.image_urls::text, '[]'), NULLIF(fp.image_urls::text, '[]')) AS image_urls,
        fd.introduction AS draft_introduction,
        fd.video_url,
        fd.main_ingredient,
        fd.sub_ingredients,
        fd.budget_plan,
        fd.schedule_plan,
        fd.refund_policy,
        fd.exchange_policy,
        r.content AS recipe_content,
        r.concept,
        r.main_ingredient AS recipe_main_ingredient,
        r.ai_sub_ingredient AS recipe_sub_ingredient
      FROM funding_projects fp
      LEFT JOIN recipes r ON r.recipe_id = fp.recipe_id
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
        message: '프로젝트를 찾을 수 없습니다.',
      });
    }

    const funding = result.rows[0];
    const subIngredients = parseFundingListField(funding.sub_ingredients || funding.recipe_sub_ingredient);
    const mainIngredient = funding.main_ingredient || funding.recipe_main_ingredient || null;
    const ingredients = [mainIngredient, ...subIngredients].filter(Boolean);
    const imageFields = buildImageFields(funding.thumbnail_url, funding.image_urls);
    const budgetPlan = parseOriginalTextField(funding.budget_plan);
    const schedulePlan = parseOriginalTextField(funding.schedule_plan);
    const projectPolicy =
      parseOriginalTextField(funding.refund_policy)
      ?? parseOriginalTextField(funding.exchange_policy);

    return res.status(200).json({
      fundingId: Number(funding.funding_id),
      title: funding.title,
      introduction: funding.draft_introduction || funding.summary || funding.description || funding.recipe_content || '',
      story: funding.description || funding.recipe_content || funding.concept || '',
      mainIngredient,
      primaryIngredient: mainIngredient,
      subIngredient: subIngredients[0] || null,
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
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '프로젝트 소개 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

//양조일지 조회
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
    const result = await pool.query(
      `
      SELECT
        bl.log_id,
        bl.funding_id,
        bl.step,
        bl.title,
        bl.content,
        bl.image_urls,
        bl.created_at,
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
      logs: result.rows.map((log) => ({
        breweryLogId: Number(log.log_id),
        logId: Number(log.log_id),
        fundingId: Number(log.funding_id),
        stage: log.step,
        title: log.title,
        content: log.content,
        imageUrls:
          typeof log.image_urls === 'string'
            ? JSON.parse(log.image_urls)
            : log.image_urls,
        likeCount: Number(log.like_count || 0),
        liked: log.liked,
        commentCount: Number(log.comment_count || 0),
        createdAt: log.created_at,
      })),
      message: '양조일지 조회 성공',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '양조일지 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 양조일지 등록
const createBreweryLog = async (req, res) => {
  const { fundingId } = req.params;
  const { stage, title, content, imageUrls } = req.body;
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
      message: '양조일지 제목과 내용을 입력해야 합니다.',
    });
  }

  if (!allowedStages.includes(stage)) {
    return res.status(400).json({
      status: 400,
      message: '양조 진행 단계가 올바르지 않습니다.',
    });
  }

  try {
    const uploadedImageUrls = [];
    for (const file of files) {
      uploadedImageUrls.push(await storeUploadedFile(file, `brewery-logs/${resolvedFundingId}`, userId));
    }

    const bodyImageUrls = parseJsonArrayField(imageUrls);
    const normalizedImageUrls = [...bodyImageUrls, ...uploadedImageUrls];

    if (normalizedImageUrls.length > 5) {
      return res.status(400).json({
        status: 400,
        message: '이미지는 최대 5개까지 등록할 수 있습니다.',
      });
    }

    const result = await pool.query(
      `
      INSERT INTO brewery_logs (
        funding_id,
        step,
        title,
        content,
        image_urls
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        log_id,
        funding_id,
        step,
        title,
        content,
        image_urls,
        created_at
      `,
      [
        resolvedFundingId,
        stage,
        title,
        content,
        JSON.stringify(normalizedImageUrls),
      ]
    );

    const log = result.rows[0];

    return res.status(201).json({
      breweryLogId: Number(log.log_id),
      logId: Number(log.log_id),
      fundingId: Number(log.funding_id),
      stage:log.step,
      title: log.title,
      content: log.content,
      imageUrls:
        typeof log.image_urls === 'string'
          ? JSON.parse(log.image_urls)
          : log.image_urls,
      likeCount: 0,
      liked: false,
      commentCount: 0,
      createdAt: log.created_at,
      message: '양조일지가 등록되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '양조일지 등록 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 양조일지 수정
const updateBreweryLog = async (req, res) => {
  const { fundingId, breweryLogId } = req.params;
  const { stage, title, content, imageUrls } = req.body;
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
      message: '양조일지를 찾을 수 없습니다.',
    });
  }

  if (!stage && !title && !content && !imageUrls && files.length === 0) {
    return res.status(400).json({
      status: 400,
      message: '양조일지 수정값이 올바르지 않습니다.',
    });
  }

  if (stage && !allowedStages.includes(stage)) {
    return res.status(400).json({
      status: 400,
      message: '양조 진행 단계가 올바르지 않습니다.',
    });
  }

  try {
    const uploadedImageUrls = [];
    for (const file of files) {
      uploadedImageUrls.push(await storeUploadedFile(file, `brewery-logs/${fundingId}`, userId));
    }

    const normalizedImageUrls = imageUrls || files.length > 0
      ? [...parseJsonArrayField(imageUrls), ...uploadedImageUrls]
      : null;

    if (normalizedImageUrls && normalizedImageUrls.length > 5) {
      return res.status(400).json({
        status: 400,
        message: '이미지는 최대 5개까지 등록할 수 있습니다.',
      });
    }

    const result = await pool.query(
      `
      UPDATE brewery_logs
      SET
        step = COALESCE($1, step),
        title = COALESCE($2, title),
        content = COALESCE($3, content),
        image_urls = COALESCE($4, image_urls)
      WHERE funding_id = $5
      AND log_id = $6
      RETURNING
        log_id,
        funding_id,
        step,
        title,
        content,
        image_urls,
        created_at
      `,
      [
        stage || null,
        title || null,
        content || null,
        normalizedImageUrls ? JSON.stringify(normalizedImageUrls) : null,
        Number(fundingId),
        Number(breweryLogId),
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '양조일지를 찾을 수 없습니다.',
      });
    }

    const log = result.rows[0];

    return res.status(200).json({
      breweryLogId: Number(log.log_id),
      logId: Number(log.log_id),
      fundingId: Number(log.funding_id),
      stage: log.step,
      title: log.title,
      content: log.content,
      imageUrls:
        typeof log.image_urls === 'string'
          ? JSON.parse(log.image_urls)
          : log.image_urls,
      createdAt: log.created_at,
      message: '양조일지가 수정되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '양조일지 수정 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 양조일지 삭제
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
      message: '양조일지를 찾을 수 없습니다.',
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
        message: '양조일지를 찾을 수 없습니다.',
      });
    }

    return res.status(200).json({
      breweryLogId: Number(result.rows[0].log_id),
      fundingId: Number(result.rows[0].funding_id),
      message: '양조일지가 삭제되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '양조일지 삭제 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
//qna 목록 조회
const getFundingQuestions = async (req, res) => {
  const { fundingId } = req.params;
  const { page = 0, size = 10, answered } = req.query;
  const userId = getUserId(req);

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
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
      message: '잘못된 요청 파라미터입니다.',
    });
  }

  if (answered !== undefined && answered !== 'true' && answered !== 'false') {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청 파라미터입니다.',
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
          writerNickname: question.writer_nickname || '사용자',
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
              writerNickname: reply.writerNickname || '사용자',
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
      message: 'Q&A 목록 조회 성공',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: 'Q&A 목록 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

//qna 질문등록
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
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  if (!content || typeof content !== 'string' || content.trim() === '') {
    return res.status(400).json({
      status: 400,
      message: '질문 입력값이 올바르지 않습니다.',
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
      writerNickname: question.writer_nickname || '사용자',
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
      message: "Q&A 질문이 등록되었습니다."
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Q&A 질문 등록 실패"
    });
  }
};

//qna 답글 등록
const createFundingReply = async (req, res) => {
  const { fundingId, questionId } = req.params;
  const { content } = req.body;

  if (!fundingId || isNaN(Number(fundingId)) || !questionId || isNaN(Number(questionId))) {
    return res.status(404).json({ status: 404, message: '질문 또는 프로젝트를 찾을 수 없습니다.' });
  }

  if (!content || typeof content !== 'string' || content.trim() === '') {
    return res.status(400).json({ status: 400, message: '답변 입력값이 올바르지 않습니다.' });
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
      writerNickname: reply.writer_nickname || '사용자',
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
      message: '답변이 등록되었습니다.',
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      status: 500,
      message: '답변 등록 중 서버 오류가 발생했습니다.',
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
      message: '잘못된 요청입니다.',
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
        message: '질문을 찾을 수 없습니다.',
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
      message: 'Q&A 좋아요를 등록했습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: 'Q&A 좋아요 등록 중 서버 오류가 발생했습니다.',
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
      message: '잘못된 요청입니다.',
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
      message: 'Q&A 좋아요를 취소했습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: 'Q&A 좋아요 취소 중 서버 오류가 발생했습니다.',
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
      message: '잘못된 요청입니다.',
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
        message: 'Q&A 답글을 찾을 수 없습니다.',
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
      message: '답글 좋아요 처리 성공',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: 'Q&A 답글 좋아요 등록 중 서버 오류가 발생했습니다.',
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
      message: '잘못된 요청입니다.',
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
      message: '답글 좋아요 처리 성공',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: 'Q&A 답글 좋아요 취소 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 후기 목록 조회
const getFundingReviews = async (req, res) => {
  const { fundingId } = req.params;
  const { page = 0, size = 10, sort = 'LATEST' } = req.query;
  const userId = getUserId(req);
  const resolvedFundingId = await resolveFundingId(fundingId);

  if (!resolvedFundingId) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
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
      message: '잘못된 요청 파라미터입니다.',
    });
  }

  const allowedSorts = ['LATEST', 'RATING'];
  if (!allowedSorts.includes(sort)) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청 파라미터입니다.',
    });
  }

  const orderBy =
    sort === 'RATING'
      ? 'ORDER BY fr.rating DESC, fr.created_at DESC'
      : 'ORDER BY fr.created_at DESC';

  try {
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
        EXISTS (
          SELECT 1
          FROM funding_review_likes my_like
          WHERE my_like.review_id = fr.review_id
          AND my_like.user_id = $4
        ) AS liked
      FROM funding_reviews fr
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
      message: '후기 목록 조회 성공',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '후기 목록 조회 중 서버 오류가 발생했습니다.',
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
      message: '후기 상세 요청값이 올바르지 않습니다.',
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
        EXISTS (
          SELECT 1
          FROM funding_review_likes my_like
          WHERE my_like.review_id = fr.review_id
          AND my_like.user_id = $3
        ) AS liked
      FROM funding_reviews fr
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
        message: '후기를 찾을 수 없습니다.',
      });
    }

    return res.status(200).json({
      ...mapFundingReview(result.rows[0]),
      message: '후기 상세 조회 성공',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '후기 상세 조회 중 서버 오류가 발생했습니다.',
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
      EXISTS (
        SELECT 1
        FROM funding_review_likes my_like
        WHERE my_like.review_id = fr.review_id
        AND my_like.user_id = $3
      ) AS liked
    FROM funding_reviews fr
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
      message: '후기 좋아요 요청값이 올바르지 않습니다.',
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
        message: '후기를 찾을 수 없습니다.',
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
      message: '후기 좋아요 처리 성공',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '후기 좋아요 등록 중 서버 오류가 발생했습니다.',
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
      message: '후기 좋아요 요청값이 올바르지 않습니다.',
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
        message: '후기를 찾을 수 없습니다.',
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
      message: '후기 좋아요 취소 성공',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '후기 좋아요 취소 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

//후원옵션조회
const getSupportOptions = async (req, res) => {
  const { fundingId } = req.params;

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  try {
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
      supportOptions: result.rows.map((option) => ({
        optionId: Number(option.option_id),
        name: option.name,
        price: Number(option.price || 0),
        description: option.description,
        volume: option.volume,
        alcohol: option.alcohol,
        stock: option.stock,
        remainingStock: option.remaining_stock,
        maxPerUser: option.max_per_user,
      })),
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '후원 옵션 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 후원 주문 생성
const createFundingOrder = async (req, res) => {
  const { fundingId } = req.params;
  const body = req.body || {};

  const optionId = getBodyValue(body, ['optionId', 'option_id']);
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



  const bottleCount = Number(quantity || optionId);

  if (
    !bottleCount ||
    !Number.isInteger(bottleCount) ||
    bottleCount <= 0 ||
    !recipientName ||
    !recipientPhone ||
    !shippingAddress
  ) {
    return res.status(400).json({
      status: 400,
      message: '주문 입력값이 올바르지 않습니다.',
    });
  }

  if (!adultVerified) {
    return res.status(400).json({
      status: 400,
      message: '주류 후원을 위해 성인인증이 필요합니다.',
    });
  }

  if (!noticeAgreed) {
    return res.status(400).json({
      status: 400,
      message: '환불/교환/리스크 안내에 동의해야 합니다.',
    });
  }

  if (!privacyAgreed) {
    return res.status(400).json({
      status: 400,
      message: '개인정보 제3자 제공에 동의해야 합니다.',
    });
  }

  const donationAmountNumber = Number(donationAmount || 0);

  if (!Number.isInteger(donationAmountNumber) || donationAmountNumber < 0) {
    return res.status(400).json({
      status: 400,
      message: '추가 후원금 입력값이 올바르지 않습니다.',
    });
  }

  try {
    const fundingResult = await pool.query(
      `
      SELECT
        funding_id,
        price_per_bottle,
        shipping_fee
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

    if (!funding.price_per_bottle) {
      return res.status(400).json({
        status: 400,
        message: '프로젝트 1병 가격이 설정되어 있지 않습니다.',
      });
    }

    const pricePerBottle = Number(funding.price_per_bottle);
    const shippingFee =
      funding.shipping_fee !== null && funding.shipping_fee !== undefined
        ? Number(funding.shipping_fee)
        : 3000;
    const totalAmount =
      pricePerBottle * bottleCount + shippingFee + donationAmountNumber;

    const userId = requireUserId(req, res);
    if (!userId) return;

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
        Number(optionId || bottleCount),
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

    return res.status(201).json({
      orderId: order.order_id,
      fundingId: order.funding_id,
      optionId: order.option_id,
      quantity: order.quantity,
      pricePerBottle: order.price_per_bottle,
      shippingFee: order.shipping_fee,
      donationAmount: order.donation_amount,
      totalAmount: order.total_amount,
      orderStatus: order.order_status,
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
      message: '후원 주문이 생성되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '후원 주문 생성 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

//양조장문의등록
const createFundingInquiry = (req, res) => {
  const { fundingId } = req.params;
  const { title, content } = req.body;

  // fundingId 검증
  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  // 입력값 검증
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
      message: '문의 입력값이 올바르지 않습니다.',
    });
  }

  return res.status(201).json({
    fundingId: Number(fundingId),
    inquiryId: 21,
    message: '문의가 등록되었습니다.',
  });
};


//추가4: 펀딩 공유 링크 조회
const getFundingShareLink = async (req, res) => {
  const { fundingId } = req.params;

  // fundingId 검증
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
        funding_id,
        title,
        COALESCE(summary, description) AS summary,
        thumbnail_url
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

    const publicBaseUrl = process.env.PUBLIC_WEB_BASE_URL || 'https://judam.com';
    const shareUrl = `${publicBaseUrl.replace(/\/$/, '')}/fundings/${fundingId}`;

    const shareResult = await pool.query(
      `
      INSERT INTO funding_shares (
        funding_id,
        share_url,
        share_count
      )
      VALUES ($1, $2, 1)
      ON CONFLICT (funding_id)
      DO UPDATE SET
        share_url = EXCLUDED.share_url,
        share_count = funding_shares.share_count + 1,
        updated_at = CURRENT_TIMESTAMP
      RETURNING share_count
      `,
      [Number(fundingId), shareUrl]
    );

    const funding = fundingResult.rows[0];

    return res.status(200).json({
      fundingId: Number(fundingId),
      shareUrl,
      title: funding.title,
      summary: funding.summary,
      thumbnailImageUrl: funding.thumbnail_url,
      shareCount: Number(shareResult.rows[0].share_count),
      message: '공유 링크가 생성되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '공유 링크 생성 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

//추가부분5: 펀딩 신고 등록
const createFundingReport = async (req, res) => {
  const { fundingId } = req.params;
  const { reason, content } = req.body || {};
  const resolvedFundingId = await resolveFundingId(fundingId);

  const reasonMap = {
    FALSE_INFORMATION: 'FALSE_INFORMATION',
    INAPPROPRIATE_CONTENT: 'INAPPROPRIATE_CONTENT',
    COPYRIGHT: 'COPYRIGHT',
    FRAUD: 'FRAUD',
    ETC: 'ETC',
    '허위 정보': 'FALSE_INFORMATION',
    '부적절한 내용': 'INAPPROPRIATE_CONTENT',
    '저작권 침해': 'COPYRIGHT',
    '사기 의심': 'FRAUD',
    기타: 'ETC',
  };
  const normalizedReason = reasonMap[reason];

  if (!resolvedFundingId) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  if (!normalizedReason) {
    return res.status(400).json({
      status: 400,
      message: '신고 입력값이 올바르지 않습니다.',
    });
  }

  try {
    const reporterId = getUserId(req);
    const result = await pool.query(
      `
      INSERT INTO funding_reports (
        funding_id,
        reporter_id,
        reason,
        content,
        status
      )
      VALUES ($1, $2, $3, $4, 'PENDING')
      RETURNING report_id, funding_id, reporter_id, reason, content, status, created_at
      `,
      [resolvedFundingId, reporterId, normalizedReason, content || null]
    );

    const report = result.rows[0];

    return res.status(201).json({
      reportId: Number(report.report_id),
      fundingId: Number(report.funding_id),
      reporterId: report.reporter_id,
      reason: report.reason,
      content: report.content,
      status: report.status,
      createdAt: report.created_at,
      message: '신고가 접수되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '신고 접수 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

//추가부분6: 펀딩 신고 목록 조회
const getFundingReports = async (req, res) => {
  const { status, page = 0, size = 10 } = req.query;

  const allowedStatuses = ['PENDING', 'REVIEWING', 'RESOLVED', 'REJECTED'];

  if (status && !allowedStatuses.includes(status)) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청 파라미터입니다.',
    });
  }

  if (isNaN(Number(page)) || isNaN(Number(size))) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청 파라미터입니다.',
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
      FROM funding_reports fr
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
      FROM funding_reports fr
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
      message: '신고 목록 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

//추가부분8: 후기작성
// 후기 작성
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
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  if (!rating || isNaN(Number(rating)) || Number(rating) < 1 || Number(rating) > 5) {
    return res.status(400).json({
      status: 400,
      message: '별점은 1점부터 5점까지 입력 가능합니다.',
    });
  }

  const normalizedContent = toTrimmedString(content || detailReview);

  if (!normalizedContent) {
    return res.status(400).json({
      status: 400,
      message: '상세 후기를 입력해주세요.',
    });
  }

  try {
    const userId = requireUserId(req, res);
    if (!userId) return;
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

    const existingResult = await pool.query(
      `
      SELECT review_id
      FROM funding_reviews
      WHERE funding_id = $1
      AND user_id = $2
      `,
      [Number(fundingId), userId]
    );

    const result = existingResult.rows.length > 0
      ? await pool.query(
        `
        UPDATE funding_reviews
        SET
          rating = $1,
          title = $2,
          content = $3,
          image_urls = $4,
          mood = $5,
          pairing = $6,
          tags = $7,
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
          Number(rating),
          title || null,
          normalizedContent,
          JSON.stringify(normalizedImageUrls),
          mood || null,
          pairing || null,
          JSON.stringify(normalizedTags),
          normalizedRecordVisibility,
          existingResult.rows[0].review_id,
        ]
      )
      : await pool.query(
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
        Number(rating),
        title || null,
        normalizedContent,
        JSON.stringify(normalizedImageUrls),
        mood || null,
        pairing || null,
        JSON.stringify(normalizedTags),
        normalizedRecordVisibility,
      ]
    );

    const review = await getFundingReviewById({
      fundingId: Number(fundingId),
      reviewId: result.rows[0].review_id,
      userId,
    }) || result.rows[0];
    const aiTasteUpdate = await updateFundingReviewAiTasteProfile({
      userId,
      review,
      requestBody: req.body || {},
      isCreate: existingResult.rows.length === 0,
    });

    return res.status(201).json({
      ...mapFundingReview(review),
      ...(aiTasteUpdate ? { aiTasteUpdate } : {}),
      message: existingResult.rows.length > 0 ? '후기가 수정되었습니다.' : '후기가 등록되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '후기 등록 중 서버 오류가 발생했습니다.',
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
      message: '후기 수정 요청값이 올바르지 않습니다.',
    });
  }

  if (rating !== undefined && (isNaN(Number(rating)) || Number(rating) < 1 || Number(rating) > 5)) {
    return res.status(400).json({
      status: 400,
      message: '별점은 1점부터 5점까지 입력 가능합니다.',
    });
  }

  try {
    const userId = requireUserId(req, res);
    if (!userId) return;
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
        message: '수정할 후기를 찾을 수 없습니다.',
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
        rating = COALESCE($1, rating),
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
        rating !== undefined ? Number(rating) : null,
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

    const review = await getFundingReviewById({
      fundingId: Number(fundingId),
      reviewId: result.rows[0].review_id,
      userId,
    }) || result.rows[0];
    const aiTasteUpdate = await updateFundingReviewAiTasteProfile({
      userId,
      review,
      requestBody: req.body || {},
      isCreate: false,
    });

    return res.status(200).json({
      ...mapFundingReview(review),
      ...(aiTasteUpdate ? { aiTasteUpdate } : {}),
      message: '후기가 수정되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '후기 수정 중 서버 오류가 발생했습니다.',
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
      message: '후기 삭제 요청값이 올바르지 않습니다.',
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
        message: '삭제할 후기를 찾을 수 없습니다.',
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
      message: '후기가 삭제되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '후기 삭제 중 서버 오류가 발생했습니다.',
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
      message: '후기 댓글 목록 요청값이 올바르지 않습니다.',
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
        message: '후기를 찾을 수 없습니다.',
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
        EXISTS (
          SELECT 1
          FROM funding_review_comment_likes my_like
          WHERE my_like.comment_id = frc.comment_id
          AND my_like.user_id = $3
        ) AS liked
      FROM funding_review_comments frc
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
      message: '후기 댓글 목록 조회 성공',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '후기 댓글 목록 조회 중 서버 오류가 발생했습니다.',
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
      message: '후기 댓글 작성 요청값이 올바르지 않습니다.',
    });
  }

  if (!content) {
    return res.status(400).json({
      status: 400,
      message: '댓글 내용을 입력해주세요.',
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
        message: '후기를 찾을 수 없습니다.',
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
        false AS liked
      FROM inserted
      LEFT JOIN users u ON u.user_id = inserted.user_id
      `,
      [resolvedFundingId, Number(reviewId), userId, content]
    );

    return res.status(201).json({
      ...mapFundingReviewComment(result.rows[0]),
      message: '후기 댓글이 등록되었습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '후기 댓글 작성 중 서버 오류가 발생했습니다.',
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
      EXISTS (
        SELECT 1
        FROM funding_review_comment_likes my_like
        WHERE my_like.comment_id = frc.comment_id
        AND my_like.user_id = $4
      ) AS liked
    FROM funding_review_comments frc
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
      message: '후기 댓글 좋아요 요청값이 올바르지 않습니다.',
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
        message: '후기 댓글을 찾을 수 없습니다.',
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
      message: '후기 댓글 좋아요 처리 성공',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '후기 댓글 좋아요 등록 중 서버 오류가 발생했습니다.',
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
      message: '후기 댓글 좋아요 요청값이 올바르지 않습니다.',
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
        message: '후기 댓글을 찾을 수 없습니다.',
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
      message: '후기 댓글 좋아요 취소 성공',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '후기 댓글 좋아요 취소 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

//추가부분9: 펀딩 찜 등록
const likeFundingProject = async (req, res) => {
  const { fundingId } = req.params;
  const resolvedFundingId = await resolveFundingId(fundingId);

  if (!resolvedFundingId) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 펀딩 ID입니다.',
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
      message: '펀딩 프로젝트를 찜했습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '찜 등록 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

//추가부분10: 펀딩 찜 해제
const unlikeFundingProject = async (req, res) => {
  const { fundingId } = req.params;
  const resolvedFundingId = await resolveFundingId(fundingId);

  if (!resolvedFundingId) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 펀딩 ID입니다.',
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
      message: '펀딩 프로젝트 찜을 해제했습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '찜 해제 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 양조일지 좋아요 등록
const likeBreweryLog = async (req, res) => {
  const { fundingId, breweryLogId } = req.params;
  const userId = requireUserId(req, res);
  if (!userId) return;

  if (!fundingId || isNaN(Number(fundingId)) || !breweryLogId || isNaN(Number(breweryLogId))) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청입니다.',
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
        message: '양조일지를 찾을 수 없습니다.',
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
      message: '양조일지 좋아요를 등록했습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '양조일지 좋아요 등록 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 양조일지 좋아요 취소
const unlikeBreweryLog = async (req, res) => {
  const { fundingId, breweryLogId } = req.params;
  const userId = requireUserId(req, res);
  if (!userId) return;

  if (!fundingId || isNaN(Number(fundingId)) || !breweryLogId || isNaN(Number(breweryLogId))) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청입니다.',
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
      message: '양조일지 좋아요를 취소했습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '양조일지 좋아요 취소 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 양조일지 댓글 등록
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
      message: '양조일지를 찾을 수 없습니다.',
    });
  }

  if (
    !content ||
    typeof content !== 'string' ||
    content.trim() === ''
  ) {
    return res.status(400).json({
      status: 400,
      message: '댓글 내용을 입력해야 합니다.',
    });
  }

  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    // 양조일지 존재 확인
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
        message: '양조일지를 찾을 수 없습니다.',
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
      writerNickname: comment.writer_nickname || '사용자',
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
      message: '양조일지 댓글이 등록되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '양조일지 댓글 등록 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 양조일지 답글 등록
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
      message: '댓글을 찾을 수 없습니다.',
    });
  }

  if (
    !content ||
    typeof content !== 'string' ||
    content.trim() === ''
  ) {
    return res.status(400).json({
      status: 400,
      message: '답글 내용을 입력해야 합니다.',
    });
  }

  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    // 부모 댓글 조회
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
        message: '부모 댓글을 찾을 수 없습니다.',
      });
    }

    const parentComment = parentCommentResult.rows[0];

    // 답글의 답글 방지
    if (parentComment.parent_comment_id !== null) {
      return res.status(400).json({
        status: 400,
        message: '답글에는 추가 답글을 작성할 수 없습니다.',
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
      writerNickname: reply.writer_nickname || '사용자',
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
      message: '답글이 등록되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '답글 등록 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 양조일지 댓글 목록 조회
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
      message: '양조일지를 찾을 수 없습니다.',
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
        writerNickname: comment.writer_nickname || '사용자',
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
              writerNickname: reply.writer_nickname || '사용자',
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
      message: '양조일지 댓글 목록 조회 성공',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '양조일지 댓글 목록 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
// 양조일지 댓글/답글 좋아요 등록
const likeBreweryLogComment = async (req, res) => {
  const { fundingId, breweryLogId, commentId, replyId } = req.params;
  const targetCommentId = replyId || commentId;
  const userId = requireUserId(req, res);
  if (!userId) return;

  if (!targetCommentId || isNaN(Number(targetCommentId))) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 댓글 ID입니다.',
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
        message: '댓글을 찾을 수 없습니다.',
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
      message: '댓글 좋아요를 등록했습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '댓글 좋아요 등록 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 양조일지 댓글/답글 좋아요 취소
const unlikeBreweryLogComment = async (req, res) => {
  const { fundingId, breweryLogId, commentId, replyId } = req.params;
  const targetCommentId = replyId || commentId;
  const userId = requireUserId(req, res);
  if (!userId) return;

  if (!targetCommentId || isNaN(Number(targetCommentId))) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 댓글 ID입니다.',
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
      message: '댓글 좋아요를 취소했습니다.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '댓글 좋아요 취소 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
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
  loadBreweryInfo, //프젝생성추가1 부분
  uploadFundingDraftFile,
  verifyPhoneForFundingDraft,
  verifyAccountForFundingDraft,//추가4
  requestBankAccountVerification,
  confirmBankAccountVerification,
  saveNotices,
  uploadDocument,
  submitFundingDraft, //프로젝트제출
  getFundingDraft,    //임시저장 단건 조회
  getFundingDraftByFundingId,
  getFundingDraftList, //임시저장 목록 조회
  deleteFundingDraft,  //임시저장 삭제
  getFundingDraftPreview,  //프로젝트 미리보기
  updateFundingProject, // 공개된 펀딩 프로젝트 수정
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
  createFundingReview,
  updateFundingReview,
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
