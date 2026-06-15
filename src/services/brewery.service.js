const path = require('path');
const pool = require('../config/db');
const { uploadFileToS3 } = require('./s3.service');
const {
  requestBreweryLicenseOcr,
  requestBreweryInsight,
} = require('./ai.service');

const MAX_BUSINESS_LICENSE_FILE_SIZE = 10 * 1024 * 1024;
const MAX_BREWERY_PROFILE_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_BUSINESS_LICENSE_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
const ALLOWED_BUSINESS_LICENSE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);
const ALLOWED_BREWERY_PROFILE_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_BREWERY_PROFILE_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const mapApplication = (row) => ({
  applicationId: row.application_id,
  userId: row.user_id,
  breweryName: row.brewery_name,
  businessNumber: row.license_number,
  licenseNumber: row.license_number,
  businessAddress: row.location ?? null,
  location: row.location ?? null,
  businessAddressDetail: row.business_address_detail ?? null,
  phoneNumber: row.phone_number ?? null,
  documentUrl: row.document_url,
  documentKey: row.document_key,
  originalName: row.original_name ?? null,
  mimeType: row.mime_type ?? null,
  fileSize: row.file_size === null || row.file_size === undefined ? null : Number(row.file_size),
  ocrStatus: row.ocr_status ?? null,
  ocrSummary: row.ocr_summary ?? null,
  ocrError: row.ocr_error ?? null,
  ocrCheckedAt: row.ocr_checked_at ?? null,
  ocr: {
    status: row.ocr_status ?? null,
    summary: row.ocr_summary ?? null,
    error: row.ocr_error ?? null,
    checkedAt: row.ocr_checked_at ?? null,
  },
  rejectReason: row.reject_reason,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapUserResponse = (row) => ({
  userId: String(row.user_id),
  email: row.email,
  nickname: row.nickname,
  phoneNumber: row.phone_number,
  provider: row.provider,
  role: row.role,
  profileImage: row.profile_image,
});

const mapBreweryProfile = (row) => ({
  profileImageUrl: row.profile_image_url || null,
  breweryName: row.brewery_name || null,
  oneLineIntroduction: row.one_line_introduction || null,
  shortIntroduction: row.short_introduction || null,
  brandStory: row.brand_story || null,
  history: row.history || null,
  establishedYear: row.established_year === null || row.established_year === undefined
    ? null
    : Number(row.established_year),
  representativeName: row.representative_name || null,
  address: row.profile_address || row.location || null,
  businessRegistrationNumber: row.license_number || null,
  phoneNumber: row.phone_number || row.user_phone_number || null,
  email: row.contact_email || row.user_email || null,
  isVerified: row.status === 'APPROVED',
});

const mapBreweryDashboardBasicInfo = (row) => ({
  breweryName: row.brewery_name || null,
  profileImageUrl: row.profile_image_url || null,
  address: row.profile_address || row.location || null,
  addressDetail: row.business_address_detail || null,
});

const parseImageUrls = (value) => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (error) {
      return value.trim() ? [value.trim()] : [];
    }
  }

  return [];
};

const resolveFundingThumbnailUrl = (row) => {
  if (row.thumbnail_url) {
    return row.thumbnail_url;
  }

  return parseImageUrls(row.image_urls)[0] || row.recipe_image_url || null;
};

const normalizeFundingStatus = (status) => String(status || '').trim().toUpperCase();

const KST_CURRENT_DATE_SQL = "(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date";

const getDashboardFundingCanonicalStatus = (row) => {
  const status = normalizeFundingStatus(row.status);

  if (['ONGOING'].includes(status)) {
    return 'ACTIVE';
  }

  if (['SUCCESSFUL', 'FUNDING_SUCCESS'].includes(status)) {
    return 'SUCCESS';
  }

  if (['FAILURE'].includes(status)) {
    return 'FAILED';
  }

  if (['CANCELLED'].includes(status)) {
    return 'CANCELED';
  }

  if (['COMPLETED', 'DELIVERED', 'DONE'].includes(status)) {
    return 'COMPLETED';
  }

  if (['PRODUCTION', 'IN_PRODUCTION', 'PRODUCING', 'MAKING'].includes(status)) {
    return 'PRODUCTION';
  }

  if (['SHIPPING', 'DELIVERING'].includes(status)) {
    return 'SHIPPING';
  }

  return status || null;
};

const getDashboardFundingStatusLabel = (row) => {
  const status = normalizeFundingStatus(row.status);
  const currentAmount = Number(row.current_amount || 0);
  const targetAmount = Number(row.target_amount || 0);
  const remainingDays = row.remaining_days === null || row.remaining_days === undefined
    ? null
    : Number(row.remaining_days);
  const startsInDays = row.starts_in_days === null || row.starts_in_days === undefined
    ? null
    : Number(row.starts_in_days);

  if (['PRODUCTION', 'IN_PRODUCTION', 'PRODUCING', 'MAKING'].includes(status)) {
    return '제작 중';
  }

  if (['SHIPPING', 'DELIVERING'].includes(status)) {
    return '배송 중';
  }

  if (['COMPLETED', 'DELIVERED', 'DONE'].includes(status)) {
    return '완료';
  }

  if (['FAILED', 'FAILURE', 'CANCELLED', 'CANCELED'].includes(status)) {
    return '펀딩 실패';
  }

  if (remainingDays !== null && remainingDays < 0) {
    return targetAmount > 0 && currentAmount >= targetAmount ? '펀딩 성공' : '펀딩 실패';
  }

  if (['SUCCESSFUL', 'SUCCESS', 'FUNDING_SUCCESS'].includes(status)) {
    return '펀딩 성공';
  }

  if (startsInDays !== null && startsInDays > 0) {
    return '펀딩 예정';
  }

  if (['READY', 'SCHEDULED', 'APPROVED'].includes(status)) {
    return '펀딩 예정';
  }

  if (targetAmount > 0 && currentAmount >= targetAmount) {
    return '목표 달성';
  }

  return '진행 중';
};

const mapBreweryDashboardFunding = (row) => {
  const currentAmount = Number(row.current_amount || 0);
  const targetAmount = Number(row.target_amount || 0);
  const rawRemainingDays = row.remaining_days === null || row.remaining_days === undefined
    ? null
    : Number(row.remaining_days);

  return {
    fundingId: Number(row.funding_id),
    title: row.title,
    breweryName: row.brewery_name || null,
    thumbnailUrl: resolveFundingThumbnailUrl(row),
    currentAmount,
    targetAmount,
    achievementRate: targetAmount > 0 ? Math.floor((currentAmount / targetAmount) * 100) : 0,
    status: getDashboardFundingCanonicalStatus(row),
    statusLabel: getDashboardFundingStatusLabel(row),
    remainingDays: rawRemainingDays === null ? null : Math.max(rawRemainingDays, 0),
    endDate: row.end_date || null,
  };
};

const mapBreweryFundingSummary = (row) => ({
  activeFundingCount: Number(row.active_funding_count || 0),
  totalFundingCount: Number(row.total_funding_count || 0),
  totalParticipantCount: Number(row.total_participant_count || 0),
});

const BREWERY_DASHBOARD_ACTIVE_FUNDING_CONDITION = `
  (
    fp.status IN ('ACTIVE', 'ONGOING')
    AND fp.end_date IS NOT NULL
    AND fp.end_date >= ${KST_CURRENT_DATE_SQL}
  )
`;

const BREWERY_DASHBOARD_COMPLETED_FUNDING_CONDITION = `
  (
    fp.status IN (
      'ENDED',
      'COMPLETED',
      'DELIVERED',
      'DONE',
      'SUCCESSFUL',
      'SUCCESS',
      'FUNDING_SUCCESS',
      'FAILED',
      'FAILURE',
      'PRODUCTION',
      'IN_PRODUCTION',
      'PRODUCING',
      'MAKING',
      'SHIPPING',
      'DELIVERING',
      'CANCELLED',
      'CANCELED'
    )
  )
`;

const mapBreweryNotification = (row) => ({
  notificationId: Number(row.notification_id),
  type: row.type,
  title: row.title,
  content: row.content,
  createdAt: row.created_at,
  isRead: Boolean(row.is_read),
  linkUrl: row.link_url || null,
  imageUrl: row.image_url || null,
  fundingId: row.funding_id === null || row.funding_id === undefined
    ? null
    : Number(row.funding_id),
  recipeId: row.recipe_id === null || row.recipe_id === undefined
    ? null
    : Number(row.recipe_id),
  progressThreshold: row.progress_threshold === null || row.progress_threshold === undefined
    ? null
    : Number(row.progress_threshold),
  metadata: row.metadata || {},
});

const mapFundingDelivery = (row, fundingId) => ({
  fundingId: Number(row?.funding_id || fundingId),
  courier: row?.courier || null,
  trackingNumber: row?.tracking_number || null,
  updatedAt: row?.updated_at || null,
});

const DELIVERY_STATUS_VALUES = new Set(['ORDERED', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELED']);
const BREWERY_INSIGHT_SUCCESS_STATUSES = [
  'SUCCESS',
  'SUCCESSFUL',
  'FUNDING_SUCCESS',
  'COMPLETED',
  'DELIVERED',
  'DONE',
];

const toDeliveryStatus = (value) => {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim().toUpperCase();
  return DELIVERY_STATUS_VALUES.has(normalized) ? normalized : null;
};

const mapBreweryFundingOrderDelivery = (row) => ({
  orderId: Number(row.order_id),
  fundingId: Number(row.funding_id),
  userId: row.user_id === null || row.user_id === undefined
    ? null
    : Number(row.user_id),
  nickname: row.nickname || null,
  recipientName: row.recipient_name || null,
  recipientPhone: row.recipient_phone || null,
  shippingAddress: row.shipping_address || null,
  shippingDetailAddress: row.shipping_detail_address || null,
  postalCode: row.postal_code || null,
  totalAmount: Number(row.total_amount || 0),
  orderStatus: row.order_status,
  paymentStatus: row.payment_status || row.order_status,
  deliveryStatus: toDeliveryStatus(row.delivery_status),
  courier: row.courier || null,
  courierCode: row.courier_code || null,
  trackingNumber: row.tracking_number || null,
  shippedAt: row.shipped_at || null,
  deliveredAt: row.delivered_at || null,
  createdAt: row.created_at,
});

const createServiceError = (statusCode, message, detail) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.detail = detail;
  return error;
};

let notificationEventColumnsCheckedAt = 0;
let notificationEventColumnsAvailable = false;

const hasBreweryNotificationEventColumns = async () => {
  const now = Date.now();

  if (notificationEventColumnsCheckedAt && now - notificationEventColumnsCheckedAt < 60_000) {
    return notificationEventColumnsAvailable;
  }

  const { rows } = await pool.query(
    `
    SELECT COUNT(*)::int AS column_count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'brewery_dashboard_notifications'
      AND column_name = ANY($1)
    `,
    [[
      'funding_id',
      'recipe_id',
      'progress_threshold',
      'metadata',
    ]],
  );

  notificationEventColumnsAvailable = Number(rows[0]?.column_count || 0) === 4;
  notificationEventColumnsCheckedAt = now;

  return notificationEventColumnsAvailable;
};

const getBreweryNotificationEventSelect = async () => {
  if (await hasBreweryNotificationEventColumns()) {
    return `
        funding_id,
        recipe_id,
        progress_threshold,
        metadata,`;
  }

  return `
        NULL::bigint AS funding_id,
        NULL::bigint AS recipe_id,
        NULL::int AS progress_threshold,
        '{}'::jsonb AS metadata,`;
};

const validateBusinessLicenseFile = (file) => {
  if (!file) {
    return;
  }

  const extension = path.extname(file.originalname || '').toLowerCase();

  if (
    !ALLOWED_BUSINESS_LICENSE_EXTENSIONS.has(extension)
    || !ALLOWED_BUSINESS_LICENSE_MIME_TYPES.has(file.mimetype)
  ) {
    throw createServiceError(
      400,
      '사업자등록증 파일 형식이 올바르지 않습니다.',
      'businessLicense는 pdf, jpg, jpeg, png 파일만 업로드할 수 있습니다.',
    );
  }

  if (file.size > MAX_BUSINESS_LICENSE_FILE_SIZE) {
    throw createServiceError(
      400,
      '사업자등록증 파일은 최대 10MB까지 업로드할 수 있습니다.',
      `file_size=${file.size}`,
    );
  }
};

const validateBreweryProfileImageFile = (file) => {
  if (!file) {
    throw createServiceError(
      400,
      '프로필 이미지 파일을 첨부해주세요.',
      'image 필드는 필수입니다.',
    );
  }

  const extension = path.extname(file.originalname || '').toLowerCase();

  if (
    !ALLOWED_BREWERY_PROFILE_IMAGE_EXTENSIONS.has(extension)
    || !ALLOWED_BREWERY_PROFILE_IMAGE_MIME_TYPES.has(file.mimetype)
  ) {
    throw createServiceError(
      400,
      '프로필 이미지 파일 형식이 올바르지 않습니다.',
      '프로필 이미지는 jpg, jpeg, png, webp 파일만 업로드할 수 있습니다.',
    );
  }

  if (file.size > MAX_BREWERY_PROFILE_IMAGE_SIZE) {
    throw createServiceError(
      400,
      '프로필 이미지는 최대 5MB까지 업로드할 수 있습니다.',
      `file_size=${file.size}`,
    );
  }
};

const uploadProfileImageFile = async (file, userId) => {
  const strictS3 = process.env.FILE_UPLOAD_STRICT_S3 === 'true';

  if (process.env.AWS_S3_BUCKET && process.env.AWS_REGION) {
    try {
      return await uploadFileToS3(
        file.buffer,
        file.originalname,
        file.mimetype,
        userId,
      );
    } catch (error) {
      if (strictS3) {
        throw error;
      }
    }
  }

  if (strictS3) {
    throw createServiceError(
      500,
      'S3 업로드 설정이 필요합니다.',
      'AWS_S3_BUCKET 또는 AWS_REGION이 설정되지 않았습니다.',
    );
  }

  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
};

const extractS3KeyFromUrl = (fileUrl) => {
  if (!fileUrl) {
    return null;
  }

  try {
    return decodeURIComponent(new URL(fileUrl).pathname.replace(/^\/+/, ''));
  } catch (error) {
    const marker = '.amazonaws.com/';
    return fileUrl.includes(marker) ? fileUrl.split(marker)[1] : null;
  }
};

const getCurrentKstPeriod = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;

  return `${year}-${month}`;
};

const normalizeBreweryInsightPeriod = (period) => {
  const normalized = typeof period === 'string' ? period.trim() : '';
  const resolved = normalized || getCurrentKstPeriod();
  const match = resolved.match(/^(\d{4})-(\d{2})$/);

  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    throw createServiceError(
      400,
      'period 형식이 올바르지 않습니다.',
      'period는 YYYY-MM 형식이어야 합니다.',
    );
  }

  return resolved;
};

const getBreweryInsightPeriodRange = (period) => {
  const [year, month] = period.split('-').map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  return {
    startDate: `${period}-01`,
    endDate: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`,
  };
};

const parseInsightList = (value) => {
  if (value === null || value === undefined || value === '') {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === 'object') {
    return Object.values(value).flatMap(parseInsightList);
  }

  const normalized = String(value).trim();

  if (!normalized) {
    return [];
  }

  try {
    return parseInsightList(JSON.parse(normalized));
  } catch (error) {
    return normalized
      .split(/[,;|]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
};

const buildFundingInsightIngredients = (row) => (
  [...new Set([
    ...parseInsightList(row.main_ingredient),
    ...parseInsightList(row.sub_ingredients),
    ...parseInsightList(row.raw_materials),
  ])]
);

const buildFundingInsightTasteVector = (row) => {
  const fields = [
    ['sweetness', row.sweetness],
    ['acidity', row.acidity],
    ['body', row.body],
    ['carbonation', row.carbonation],
    ['alcohol_intensity', row.alcohol_intensity],
  ];

  return Object.fromEntries(fields
    .filter(([, value]) => value !== null && value !== undefined && Number.isFinite(Number(value)))
    .map(([key, value]) => [key, Number(value)]));
};

const buildBtiInsightKeywords = (row) => {
  const tasteKeywords = [
    { keyword: '단맛', score: Number(row.avg_sweetness || 0) },
    { keyword: '바디감/묵직함', score: Number(row.avg_body || 0) },
    { keyword: '탄산감', score: Number(row.avg_carbonation || 0) },
    { keyword: '풍미/향', score: Number(row.avg_flavor || 0) },
  ]
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map(({ keyword }) => keyword);
  const averageAbv = Number(row.avg_abv || 0);
  const abvKeyword = averageAbv >= 3.5 ? '고도수' : '저도수';

  return [...tasteKeywords, abvKeyword];
};

const getFirstDefined = (...values) => values.find(
  (value) => value !== undefined && value !== null && value !== '',
);

const getNestedValue = (source, pathSegments) => {
  if (!source || typeof source !== 'object') {
    return undefined;
  }

  return pathSegments.reduce((current, segment) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }

    return current[segment];
  }, source);
};

const getOcrValue = (source, paths) => getFirstDefined(
  ...paths.map((pathValue) => getNestedValue(source, pathValue.split('.'))),
);

const summarizeBreweryOcrResult = (rawResult = {}) => {
  const source = rawResult.data || rawResult.result || rawResult.ocrResult || rawResult;
  const extracted = source.extracted || source.extractedInfo || source.fields || source.license || source.document || source;

  return {
    manualReviewOnly: true,
    reviewPolicy: 'OCR_RESULT_IS_FOR_ADMIN_REVIEW_ONLY',
    verdict: getOcrValue(source, ['verdict', 'status', 'result', 'verificationStatus']) || null,
    confidence: getOcrValue(source, ['confidence', 'score', 'ocrConfidence']) || null,
    businessName: getOcrValue(extracted, [
      'businessName',
      'business_name',
      'companyName',
      'company_name',
      'breweryName',
      'brewery_name',
      'license.businessName',
    ]) || null,
    businessNumber: getOcrValue(extracted, [
      'businessNumber',
      'business_number',
      'registrationNumber',
      'registration_number',
      'licenseNumber',
      'license_number',
      'bizNo',
      'license.businessNumber',
    ]) || null,
    representativeName: getOcrValue(extracted, [
      'representativeName',
      'representative_name',
      'ownerName',
      'owner_name',
      'ceoName',
      'license.representativeName',
    ]) || null,
    address: getOcrValue(extracted, [
      'address',
      'businessAddress',
      'business_address',
      'location',
      'license.address',
    ]) || null,
    licenseType: getOcrValue(extracted, [
      'licenseType',
      'license_type',
      'documentType',
      'document_type',
      'permitType',
      'license.licenseType',
    ]) || null,
    issueDate: getOcrValue(extracted, [
      'issueDate',
      'issue_date',
      'issuedAt',
      'issued_at',
      'license.issueDate',
    ]) || null,
  };
};

const buildSkippedOcrReview = (reason) => ({
  status: 'SKIPPED',
  result: null,
  summary: {
    manualReviewOnly: true,
    reviewPolicy: 'OCR_RESULT_IS_FOR_ADMIN_REVIEW_ONLY',
    reason,
  },
  error: null,
  checkedAt: null,
});

const getBreweryOcrErrorMessage = (result, fallback) => {
  const errorValue = getFirstDefined(
    result?.error,
    result?.message,
    result?.detail,
  );

  if (typeof errorValue === 'string' && errorValue.trim()) {
    return errorValue.trim();
  }

  if (errorValue !== undefined) {
    try {
      return JSON.stringify(errorValue);
    } catch (error) {
      return String(errorValue);
    }
  }

  return fallback;
};

const buildFailedOcrReview = ({
  result,
  error,
  checkedAt,
  reason,
}) => ({
  status: 'FAILED',
  result: result || null,
  summary: {
    manualReviewOnly: true,
    reviewPolicy: 'OCR_RESULT_IS_FOR_ADMIN_REVIEW_ONLY',
    reviewRequired: true,
    reason,
  },
  error,
  checkedAt,
});

const runBreweryLicenseOcrReview = async ({
  businessLicenseFile,
  documentUrl,
  documentKey,
}) => {
  if (!businessLicenseFile) {
    return buildSkippedOcrReview('DOCUMENT_URL_ONLY');
  }

  const checkedAt = new Date();

  try {
    const result = await requestBreweryLicenseOcr({
      file: businessLicenseFile,
      documentUrl,
      documentKey,
    });
    const responseStatus = typeof result?.status === 'string'
      ? result.status.trim().toUpperCase()
      : '';

    if (responseStatus === 'COMPLETED') {
      return {
        status: 'COMPLETED',
        result,
        summary: summarizeBreweryOcrResult(result),
        error: null,
        checkedAt,
      };
    }

    if (responseStatus === 'FAILED') {
      return buildFailedOcrReview({
        result,
        error: getBreweryOcrErrorMessage(result, 'OCR processing failed'),
        checkedAt,
        reason: 'OCR_FAILED_APPLICATION_SAVED_FOR_MANUAL_REVIEW',
      });
    }

    const unexpectedStatus = responseStatus || 'MISSING';

    return buildFailedOcrReview({
      result,
      error: `Unexpected OCR response status: ${unexpectedStatus}`,
      checkedAt,
      reason: 'UNEXPECTED_OCR_RESPONSE_STATUS',
    });
  } catch (error) {
    return buildFailedOcrReview({
      result: null,
      error: error.message || 'OCR request failed',
      checkedAt,
      reason: 'OCR_FAILED_APPLICATION_SAVED_FOR_MANUAL_REVIEW',
    });
  }
};

const createApplication = async ({
  userId,
  breweryName,
  licenseNumber,
  location,
  businessAddressDetail,
  phoneNumber,
  businessLicenseFile,
  documentUrl,
  documentKey,
}) => {
  validateBusinessLicenseFile(businessLicenseFile);

  const existingApplication = await pool.query(
    `
      SELECT
        application_id,
        user_id,
        brewery_name,
        license_number,
        location,
        business_address_detail,
        phone_number,
        document_url,
        document_key,
        original_name,
        mime_type,
        file_size,
        ocr_status,
        ocr_result,
        ocr_summary,
        ocr_error,
        ocr_checked_at,
        reject_reason,
        status,
        created_at,
        updated_at
      FROM brewery_auth
      WHERE user_id = $1
        AND status IN ('PENDING', 'APPROVED')
      ORDER BY
        CASE WHEN status = 'APPROVED' THEN 0 ELSE 1 END,
        updated_at DESC NULLS LAST,
        created_at DESC
      LIMIT 1
    `,
    [userId],
  );

  const existing = existingApplication.rows[0] || null;

  if (existing?.status === 'APPROVED') {
    const userResult = await pool.query(
      `
        UPDATE users
        SET
          role = 'BREWERY',
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
          AND deleted_at IS NULL
        RETURNING
          user_id,
          email,
          nickname,
          phone_number,
          provider,
          role,
          profile_image
      `,
      [userId],
    );

    if (userResult.rows.length === 0) {
      throw createServiceError(404, '?ъ슜?먮? 李얠쓣 ???놁뒿?덈떎.', `user_id=${userId}`);
    }

    return {
      ...mapApplication(existing),
      user: mapUserResponse(userResult.rows[0]),
    };
  }

  let uploadedDocumentUrl = documentUrl || null;
  let uploadedDocumentKey = documentKey || null;
  let originalName = null;
  let mimeType = null;
  let fileSize = null;
  let ocrReview = buildSkippedOcrReview('NO_UPLOADED_FILE');

  if (businessLicenseFile) {
    uploadedDocumentUrl = await uploadFileToS3(
      businessLicenseFile.buffer,
      businessLicenseFile.originalname,
      businessLicenseFile.mimetype,
      userId,
    );
    uploadedDocumentKey = extractS3KeyFromUrl(uploadedDocumentUrl);
    originalName = businessLicenseFile.originalname;
    mimeType = businessLicenseFile.mimetype;
    fileSize = businessLicenseFile.size;
    ocrReview = await runBreweryLicenseOcrReview({
      businessLicenseFile,
      documentUrl: uploadedDocumentUrl,
      documentKey: uploadedDocumentKey,
    });
  } else if (uploadedDocumentUrl) {
    ocrReview = buildSkippedOcrReview('DOCUMENT_URL_ONLY');
  }

  if (existing?.status === 'PENDING') {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `
          UPDATE brewery_auth
          SET
            license_number = $1,
            status = 'PENDING',
            location = $2,
            brewery_name = $3,
            business_address_detail = $4,
            phone_number = $5,
            document_url = $6,
            document_key = $7,
            original_name = $8,
            mime_type = $9,
            file_size = $10,
            ocr_status = $11,
            ocr_result = $12,
            ocr_summary = $13,
            ocr_error = $14,
            ocr_checked_at = $15,
            reject_reason = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE application_id = $16
          RETURNING
            application_id,
            user_id,
            brewery_name,
            license_number,
            location,
            business_address_detail,
            phone_number,
            document_url,
            document_key,
            original_name,
            mime_type,
            file_size,
            ocr_status,
            ocr_result,
            ocr_summary,
            ocr_error,
            ocr_checked_at,
            reject_reason,
            status,
            created_at,
            updated_at
        `,
        [
          licenseNumber,
          location || null,
          breweryName,
          businessAddressDetail || null,
          phoneNumber,
          uploadedDocumentUrl,
          uploadedDocumentKey,
          originalName,
          mimeType,
          fileSize,
          ocrReview.status,
          ocrReview.result,
          ocrReview.summary,
          ocrReview.error,
          ocrReview.checkedAt,
          existing.application_id,
        ],
      );

      const userResult = await client.query(
        `
          UPDATE users
          SET
            role = 'BREWERY_PENDING',
            updated_at = CURRENT_TIMESTAMP
          WHERE user_id = $1
            AND deleted_at IS NULL
          RETURNING
            user_id,
            email,
            nickname,
            phone_number,
            provider,
            role,
            profile_image
        `,
        [userId],
      );

      if (userResult.rows.length === 0) {
        throw createServiceError(404, '?ъ슜?먮? 李얠쓣 ???놁뒿?덈떎.', `user_id=${userId}`);
      }

      await client.query('COMMIT');

      return {
        ...mapApplication(rows[0]),
        user: mapUserResponse(userResult.rows[0]),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
        INSERT INTO brewery_auth (
          user_id,
          license_number,
          status,
          location,
          brewery_name,
          business_address_detail,
          phone_number,
          document_url,
          document_key,
          original_name,
          mime_type,
          file_size,
          ocr_status,
          ocr_result,
          ocr_summary,
          ocr_error,
          ocr_checked_at,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          'PENDING',
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
          $13,
          $14,
          $15,
          $16,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        RETURNING
          application_id,
          user_id,
          brewery_name,
          license_number,
          location,
          business_address_detail,
          phone_number,
          document_url,
          document_key,
          original_name,
          mime_type,
          file_size,
          ocr_status,
          ocr_result,
          ocr_summary,
          ocr_error,
          ocr_checked_at,
          reject_reason,
          status,
          created_at,
          updated_at
      `,
      [
        userId,
        licenseNumber,
        location || null,
        breweryName,
        businessAddressDetail || null,
        phoneNumber,
        uploadedDocumentUrl,
        uploadedDocumentKey,
        originalName,
        mimeType,
        fileSize,
        ocrReview.status,
        ocrReview.result,
        ocrReview.summary,
        ocrReview.error,
        ocrReview.checkedAt,
      ],
    );

    const userResult = await client.query(
      `
        UPDATE users
        SET
          role = 'BREWERY_PENDING',
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
          AND deleted_at IS NULL
        RETURNING
          user_id,
          email,
          nickname,
          phone_number,
          provider,
          role,
          profile_image
      `,
      [userId],
    );

    if (userResult.rows.length === 0) {
      throw createServiceError(404, '사용자를 찾을 수 없습니다.', `user_id=${userId}`);
    }

    await client.query('COMMIT');

    return {
      ...mapApplication(rows[0]),
      user: mapUserResponse(userResult.rows[0]),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getApplications = async ({ status } = {}) => {
  const values = [];
  const whereClause = status ? 'WHERE status = $1' : '';

  if (status) {
    values.push(status);
  }

  const { rows } = await pool.query(
    `
      SELECT
        application_id,
        user_id,
        brewery_name,
        license_number,
        location,
        business_address_detail,
        phone_number,
        document_url,
        document_key,
        original_name,
        mime_type,
        file_size,
        ocr_status,
        ocr_result,
        ocr_summary,
        ocr_error,
        ocr_checked_at,
        reject_reason,
        status,
        created_at,
        updated_at
      FROM brewery_auth
      ${whereClause}
      ORDER BY created_at DESC
    `,
    values,
  );

  return rows.map(mapApplication);
};

const getApplicationByUserId = async (userId) => {
  const { rows } = await pool.query(
    `
      SELECT
        application_id,
        user_id,
        brewery_name,
        license_number,
        location,
        business_address_detail,
        phone_number,
        document_url,
        document_key,
        original_name,
        mime_type,
        file_size,
        ocr_status,
        ocr_result,
        ocr_summary,
        ocr_error,
        ocr_checked_at,
        reject_reason,
        status,
        created_at,
        updated_at
      FROM brewery_auth
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [userId],
  );

  if (rows.length === 0) {
    throw createServiceError(
      404,
      '양조장 인증 신청 내역을 찾을 수 없습니다.',
      `user_id=${userId}`,
    );
  }

  return mapApplication(rows[0]);
};

const approveApplication = async (applicationId) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const applicationResult = await client.query(
      `
        UPDATE brewery_auth
        SET
          status = 'APPROVED',
          updated_at = CURRENT_TIMESTAMP
        WHERE application_id = $1
        RETURNING application_id, user_id, status
      `,
      [applicationId],
    );

    if (applicationResult.rows.length === 0) {
      throw createServiceError(
        404,
        '양조장 인증 신청을 찾을 수 없습니다.',
        `application_id=${applicationId}`,
      );
    }

    const application = applicationResult.rows[0];

    const userResult = await client.query(
      `
        UPDATE users
        SET
          role = 'BREWERY',
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
        RETURNING user_id, role
      `,
      [application.user_id],
    );

    if (userResult.rows.length === 0) {
      throw createServiceError(
        404,
        '양조장 인증 신청에 연결된 사용자를 찾을 수 없습니다.',
        `user_id=${application.user_id}`,
      );
    }

    await client.query('COMMIT');

    return {
      applicationId: application.application_id,
      userId: application.user_id,
      status: application.status,
      role: userResult.rows[0].role,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const rejectApplication = async ({ applicationId, rejectReason }) => {
  const { rows } = await pool.query(
    `
      UPDATE brewery_auth
      SET
        status = 'REJECTED',
        reject_reason = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE application_id = $1
      RETURNING
        application_id,
        user_id,
        brewery_name,
        license_number,
        location,
        business_address_detail,
        phone_number,
        document_url,
        document_key,
        original_name,
        mime_type,
        file_size,
        ocr_status,
        ocr_result,
        ocr_summary,
        ocr_error,
        ocr_checked_at,
        reject_reason,
        status,
        created_at,
        updated_at
    `,
    [applicationId, rejectReason],
  );

  if (rows.length === 0) {
    throw createServiceError(
      404,
      '양조장 인증 신청을 찾을 수 없습니다.',
      `application_id=${applicationId}`,
    );
  }

  return mapApplication(rows[0]);
};

const rejectApplicationWithRoleUpdate = async ({ applicationId, rejectReason }) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
        UPDATE brewery_auth
        SET
          status = 'REJECTED',
          reject_reason = $2,
          updated_at = CURRENT_TIMESTAMP
        WHERE application_id = $1
        RETURNING
          application_id,
          user_id,
          brewery_name,
          license_number,
          location,
          business_address_detail,
          phone_number,
          document_url,
          document_key,
          original_name,
          mime_type,
          file_size,
          ocr_status,
          ocr_result,
          ocr_summary,
          ocr_error,
          ocr_checked_at,
          reject_reason,
          status,
          created_at,
          updated_at
      `,
      [applicationId, rejectReason],
    );

    if (rows.length === 0) {
      throw createServiceError(
        404,
        '?묒“???몄쬆 ?좎껌??李얠쓣 ???놁뒿?덈떎.',
        `application_id=${applicationId}`,
      );
    }

    const application = rows[0];
    const { rows: approvedRows } = await client.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM brewery_auth
          WHERE user_id = $1
            AND status = 'APPROVED'
        ) AS has_approved_brewery
      `,
      [application.user_id],
    );
    const nextRole = approvedRows[0]?.has_approved_brewery ? 'BREWERY' : 'USER';

    const userResult = await client.query(
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
          provider,
          role,
          profile_image
      `,
      [nextRole, application.user_id],
    );

    if (userResult.rows.length === 0) {
      throw createServiceError(
        404,
        '?묒“???몄쬆 ?좎껌???곌껐???ъ슜?먮? 李얠쓣 ???놁뒿?덈떎.',
        `user_id=${application.user_id}`,
      );
    }

    await client.query('COMMIT');

    return {
      ...mapApplication(application),
      user: mapUserResponse(userResult.rows[0]),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const updateApprovedApplicationByUserId = async ({
  userId,
  breweryName,
  licenseNumber,
  location,
  documentUrl,
  documentKey,
}) => {
  const updates = [];
  const values = [userId];

  const addUpdate = (column, value) => {
    if (value === undefined) {
      return;
    }

    values.push(value);
    updates.push(`${column} = $${values.length}`);
  };

  addUpdate('brewery_name', breweryName);
  addUpdate('license_number', licenseNumber);
  addUpdate('location', location);
  addUpdate('document_url', documentUrl);
  addUpdate('document_key', documentKey);

  if (updates.length === 0) {
    throw createServiceError(
      400,
      '수정할 양조장 정보가 없습니다.',
      'breweryName, licenseNumber, location, documentUrl, documentKey 중 하나 이상 필요합니다.',
    );
  }

  const { rows } = await pool.query(
    `
      UPDATE brewery_auth
      SET
        ${updates.join(', ')},
        updated_at = CURRENT_TIMESTAMP
      WHERE application_id = (
        SELECT application_id
        FROM brewery_auth
        WHERE user_id = $1
          AND status = 'APPROVED'
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      )
      RETURNING
        application_id,
        user_id,
        brewery_name,
        license_number,
        location AS location,
        document_url,
        document_key,
        ocr_status,
        ocr_result,
        ocr_summary,
        ocr_error,
        ocr_checked_at,
        reject_reason,
        status,
        created_at,
        updated_at
    `,
    values,
  );

  if (rows.length === 0) {
    throw createServiceError(
      404,
      '승인된 양조장 인증 정보를 찾을 수 없습니다.',
      `user_id=${userId}`,
    );
  }

  return mapApplication(rows[0]);
};

const assertBreweryDashboardUser = async (userId) => {
  const { rows } = await pool.query(
    `
      SELECT
        u.user_id,
        u.role,
        EXISTS (
          SELECT 1
          FROM brewery_auth ba
          WHERE ba.user_id = u.user_id
            AND ba.status = 'APPROVED'
        ) AS has_approved_brewery
      FROM users u
      WHERE u.user_id = $1
        AND u.deleted_at IS NULL
      LIMIT 1
    `,
    [userId],
  );

  if (rows.length === 0) {
    throw createServiceError(404, '사용자를 찾을 수 없습니다.', `user_id=${userId}`);
  }

  const role = String(rows[0].role || '').toUpperCase();

  if (role !== 'BREWERY' && !rows[0].has_approved_brewery) {
    throw createServiceError(
      403,
      '양조장 계정만 사용할 수 있는 기능입니다.',
      `user_id=${userId}`,
    );
  }

  return rows[0];
};

const getBreweryProfileByUserId = async (userId) => {
  await assertBreweryDashboardUser(userId);

  const { rows } = await pool.query(
    `
      SELECT
        ba.application_id,
        ba.user_id,
        COALESCE(bp.brewery_name, ba.brewery_name) AS brewery_name,
        ba.license_number,
        ba.status,
        ba.location,
        ba.phone_number,
        bp.profile_image_url,
        bp.one_line_introduction,
        bp.short_introduction,
        bp.brand_story,
        bp.history,
        bp.established_year,
        bp.representative_name,
        bp.address AS profile_address,
        bp.contact_email,
        u.email AS user_email,
        u.phone_number AS user_phone_number,
        u.profile_image AS user_profile_image
      FROM brewery_auth ba
      JOIN users u ON u.user_id = ba.user_id
      LEFT JOIN brewery_profiles bp ON bp.user_id = ba.user_id
      WHERE ba.user_id = $1
        AND ba.status = 'APPROVED'
      ORDER BY ba.updated_at DESC, ba.created_at DESC
      LIMIT 1
    `,
    [userId],
  );

  if (rows.length === 0) {
    throw createServiceError(
      404,
      '승인된 양조장 프로필을 찾을 수 없습니다.',
      `user_id=${userId}`,
    );
  }

  return mapBreweryProfile(rows[0]);
};

const getBreweryDashboardBasicInfoByUserId = async (userId) => {
  await assertBreweryDashboardUser(userId);

  const { rows } = await pool.query(
    `
      SELECT
        COALESCE(bp.brewery_name, ba.brewery_name) AS brewery_name,
        bp.profile_image_url,
        ba.location,
        bp.address AS profile_address,
        ba.business_address_detail
      FROM brewery_auth ba
      LEFT JOIN brewery_profiles bp ON bp.user_id = ba.user_id
      WHERE ba.user_id = $1
        AND ba.status = 'APPROVED'
      ORDER BY ba.updated_at DESC, ba.created_at DESC
      LIMIT 1
    `,
    [userId],
  );

  if (rows.length === 0) {
    throw createServiceError(
      404,
      '승인된 양조장 기본 정보를 찾을 수 없습니다.',
      `user_id=${userId}`,
    );
  }

  return mapBreweryDashboardBasicInfo(rows[0]);
};

const updateBreweryProfileByUserId = async ({ userId, profile }) => {
  await assertBreweryDashboardUser(userId);

  const columns = ['user_id', 'application_id'];
  const selectValues = ['$1', 'latest_application.application_id'];
  const updateAssignments = ['application_id = EXCLUDED.application_id'];
  const values = [userId];

  const addProfileValue = (column, value) => {
    if (value === undefined) {
      return;
    }

    values.push(value);
    columns.push(column);
    selectValues.push(`$${values.length}`);
    updateAssignments.push(`${column} = EXCLUDED.${column}`);
  };

  addProfileValue('profile_image_url', profile.profileImageUrl);
  addProfileValue('brewery_name', profile.breweryName);
  addProfileValue('one_line_introduction', profile.oneLineIntroduction);
  addProfileValue('short_introduction', profile.shortIntroduction);
  addProfileValue('brand_story', profile.brandStory);
  addProfileValue('history', profile.history);
  addProfileValue('established_year', profile.establishedYear);
  addProfileValue('representative_name', profile.representativeName);
  addProfileValue('address', profile.address);
  addProfileValue('contact_email', profile.email);

  if (columns.length === 2) {
    throw createServiceError(
      400,
      '수정할 양조장 프로필 정보가 없습니다.',
      'profileImageUrl, breweryName, oneLineIntroduction, shortIntroduction, brandStory, history, establishedYear, representativeName, address, email 중 하나 이상 필요합니다.',
    );
  }

  const { rows } = await pool.query(
    `
      WITH latest_application AS (
        SELECT
          application_id,
          user_id
        FROM brewery_auth
        WHERE user_id = $1
          AND status = 'APPROVED'
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      ),
      upserted AS (
        INSERT INTO brewery_profiles (
          ${columns.join(', ')}
        )
        SELECT
          ${selectValues.join(', ')}
        FROM latest_application
        ON CONFLICT (user_id) DO UPDATE
        SET
          ${updateAssignments.join(', ')},
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      )
      SELECT
        ba.application_id,
        ba.user_id,
        COALESCE(upserted.brewery_name, ba.brewery_name) AS brewery_name,
        ba.license_number,
        ba.status,
        ba.location,
        ba.phone_number,
        upserted.profile_image_url,
        upserted.one_line_introduction,
        upserted.short_introduction,
        upserted.brand_story,
        upserted.history,
        upserted.established_year,
        upserted.representative_name,
        upserted.address AS profile_address,
        upserted.contact_email,
        u.email AS user_email,
        u.phone_number AS user_phone_number,
        u.profile_image AS user_profile_image
      FROM upserted
      JOIN brewery_auth ba ON ba.application_id = upserted.application_id
      JOIN users u ON u.user_id = upserted.user_id
    `,
    values,
  );

  if (rows.length === 0) {
    throw createServiceError(
      404,
      '승인된 양조장 프로필을 찾을 수 없습니다.',
      `user_id=${userId}`,
    );
  }

  return mapBreweryProfile(rows[0]);
};

const uploadBreweryProfileImageByUserId = async ({ userId, file }) => {
  await assertBreweryDashboardUser(userId);
  validateBreweryProfileImageFile(file);

  const profileImageUrl = await uploadProfileImageFile(file, userId);
  const profile = await updateBreweryProfileByUserId({
    userId,
    profile: {
      profileImageUrl,
    },
  });

  return {
    profileImageUrl,
    profile,
  };
};

const getBreweryFundingSummaryByUserId = async (userId) => {
  await assertBreweryDashboardUser(userId);

  const { rows } = await pool.query(
    `
      SELECT
        COUNT(DISTINCT fp.funding_id) FILTER (
          WHERE ${BREWERY_DASHBOARD_ACTIVE_FUNDING_CONDITION}
        )::int AS active_funding_count,
        COUNT(DISTINCT fp.funding_id) FILTER (
          WHERE (${BREWERY_DASHBOARD_ACTIVE_FUNDING_CONDITION})
             OR (${BREWERY_DASHBOARD_COMPLETED_FUNDING_CONDITION})
        )::int AS total_funding_count,
        COUNT(DISTINCT o.user_id) FILTER (
          WHERE o.order_status = 'PAID'
            AND o.user_id IS NOT NULL
            AND (
              (${BREWERY_DASHBOARD_ACTIVE_FUNDING_CONDITION})
              OR (${BREWERY_DASHBOARD_COMPLETED_FUNDING_CONDITION})
            )
        )::int AS total_participant_count
      FROM funding_projects fp
      LEFT JOIN orders o ON o.funding_id = fp.funding_id
      WHERE fp.brewery_user_id = $1
    `,
    [userId],
  );

  return mapBreweryFundingSummary(rows[0] || {});
};

const getBreweryDashboardFundingsByUserId = async ({
  userId,
  status,
  page,
  size,
}) => {
  await assertBreweryDashboardUser(userId);

  const normalizedStatus = String(status || '').trim().toLowerCase();
  const statusConditions = {
    active: BREWERY_DASHBOARD_ACTIVE_FUNDING_CONDITION,
    completed: BREWERY_DASHBOARD_COMPLETED_FUNDING_CONDITION,
  };

  const statusCondition = statusConditions[normalizedStatus];

  if (!statusCondition) {
    throw createServiceError(
      400,
      '펀딩 목록 상태 값이 올바르지 않습니다.',
      'status는 active 또는 completed여야 합니다.',
    );
  }

  const baseValues = [userId];
  const baseWhere = `
    WHERE fp.brewery_user_id = $1
      AND ${statusCondition}
  `;

  const countResult = await pool.query(
    `
      SELECT COUNT(*)::int AS total_count
      FROM funding_projects fp
      ${baseWhere}
    `,
    baseValues,
  );

  const totalElements = Number(countResult.rows[0]?.total_count || 0);
  const { rows } = await pool.query(
    `
      SELECT
        fp.funding_id,
        fp.title,
        COALESCE(bp.brewery_name, ba.brewery_name, u.nickname) AS brewery_name,
        fp.thumbnail_url,
        fp.image_urls,
        r.image_url AS recipe_image_url,
        fp.current_amount,
        fp.goal_amount AS target_amount,
        fp.status,
        fp.start_date,
        fp.end_date,
        CASE
          WHEN fp.start_date IS NULL THEN NULL
          ELSE (fp.start_date - ${KST_CURRENT_DATE_SQL})::int
        END AS starts_in_days,
        CASE
          WHEN fp.end_date IS NULL THEN NULL
          ELSE (fp.end_date - ${KST_CURRENT_DATE_SQL})::int
        END AS remaining_days
      FROM funding_projects fp
      JOIN users u ON u.user_id = fp.brewery_user_id
      LEFT JOIN recipes r ON r.recipe_id = fp.recipe_id
      LEFT JOIN brewery_profiles bp ON bp.user_id = fp.brewery_user_id
      LEFT JOIN LATERAL (
        SELECT brewery_name
        FROM brewery_auth
        WHERE user_id = fp.brewery_user_id
          AND status = 'APPROVED'
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      ) ba ON TRUE
      ${baseWhere}
      ORDER BY
        CASE
          WHEN fp.end_date IS NULL THEN 1
          ELSE 0
        END,
        fp.end_date ASC NULLS LAST,
        fp.created_at DESC,
        fp.funding_id DESC
      LIMIT $2
      OFFSET $3
    `,
    [
      ...baseValues,
      size,
      page * size,
    ],
  );

  const fundings = rows.map(mapBreweryDashboardFunding);

  return {
    content: fundings,
    data: fundings,
    page,
    size,
    totalElements,
    totalPages: Math.ceil(totalElements / size) || 1,
  };
};

const getBreweryOwnedFundingForDashboard = async ({ userId, fundingId }) => {
  await assertBreweryDashboardUser(userId);

  const numericFundingId = Number(fundingId);

  if (!Number.isInteger(numericFundingId) || numericFundingId <= 0) {
    throw createServiceError(400, '펀딩 ID가 올바르지 않습니다.', `funding_id=${fundingId}`);
  }

  const { rows } = await pool.query(
    `
      SELECT
        fp.funding_id,
        fp.brewery_user_id,
        fp.status,
        fp.end_date,
        (${BREWERY_DASHBOARD_COMPLETED_FUNDING_CONDITION}) AS is_completed
      FROM funding_projects fp
      WHERE fp.funding_id = $1
      LIMIT 1
    `,
    [numericFundingId],
  );

  if (rows.length === 0) {
    throw createServiceError(
      404,
      '펀딩 프로젝트를 찾을 수 없습니다.',
      `funding_id=${numericFundingId}`,
    );
  }

  const funding = rows[0];

  if (Number(funding.brewery_user_id) !== Number(userId)) {
    throw createServiceError(
      403,
      '해당 펀딩의 배송 정보에 접근할 권한이 없습니다.',
      `funding_id=${numericFundingId}, user_id=${userId}`,
    );
  }

  return {
    fundingId: Number(funding.funding_id),
    breweryUserId: Number(funding.brewery_user_id),
    status: funding.status,
    endDate: funding.end_date,
    isCompleted: Boolean(funding.is_completed),
  };
};

const getBreweryFundingDeliveryByUserId = async ({ userId, fundingId }) => {
  const funding = await getBreweryOwnedFundingForDashboard({ userId, fundingId });

  const { rows } = await pool.query(
    `
      SELECT
        funding_id,
        courier,
        tracking_number,
        updated_at
      FROM funding_deliveries
      WHERE funding_id = $1
      LIMIT 1
    `,
    [funding.fundingId],
  );

  return mapFundingDelivery(rows[0], funding.fundingId);
};

const getBreweryFundingOrdersByUserId = async ({ userId, fundingId }) => {
  const funding = await getBreweryOwnedFundingForDashboard({ userId, fundingId });

  const { rows } = await pool.query(
    `
      SELECT
        o.order_id,
        o.funding_id,
        o.user_id,
        u.nickname,
        o.recipient_name,
        o.recipient_phone,
        o.shipping_address,
        o.shipping_detail_address,
        o.postal_code,
        o.total_amount,
        o.order_status,
        o.delivery_status,
        o.courier,
        o.courier_code,
        o.tracking_number,
        o.shipped_at,
        o.delivered_at,
        o.created_at,
        p.payment_status
      FROM orders o
      LEFT JOIN users u ON u.user_id = o.user_id
      LEFT JOIN LATERAL (
        SELECT payment_status
        FROM payments
        WHERE order_id = o.order_id
        ORDER BY created_at DESC
        LIMIT 1
      ) p ON TRUE
      WHERE o.funding_id = $1
        AND o.order_status = 'PAID'
      ORDER BY o.created_at DESC, o.order_id DESC
    `,
    [funding.fundingId],
  );

  return rows.map(mapBreweryFundingOrderDelivery);
};

const updateBreweryFundingOrderDeliveryByUserId = async ({
  userId,
  fundingId,
  orderId,
  deliveryStatus,
  courier,
  courierCode,
  trackingNumber,
}) => {
  const funding = await getBreweryOwnedFundingForDashboard({ userId, fundingId });
  const normalizedOrderId = Number(orderId);

  if (!Number.isInteger(normalizedOrderId) || normalizedOrderId <= 0) {
    throw createServiceError(400, 'orderId 格뚮씪?ㅻ씤 ?뚯씠?섎㏈ ???낅젰?댁＜?몄슂.');
  }

  const { rows: orderRows } = await pool.query(
    `
      SELECT order_id, funding_id, order_status
      FROM orders
      WHERE order_id = $1
        AND funding_id = $2
      LIMIT 1
    `,
    [normalizedOrderId, funding.fundingId],
  );

  if (orderRows.length === 0) {
    throw createServiceError(
      404,
      '二쇰Ц ?댁쾦 ?닿쨷 ?낅젰?댁＜?몄슂.',
      `funding_id=${funding.fundingId}, order_id=${normalizedOrderId}`,
    );
  }

  if (orderRows[0].order_status !== 'PAID') {
    throw createServiceError(
      400,
      'PAID ?덉쭛 ?댁쾦 ?됭낵 ?ㅽ듬?먭슂?댄利좎꽭?꾨쾡.',
    );
  }

  const normalizedDeliveryStatus = toDeliveryStatus(deliveryStatus);
  if (deliveryStatus !== undefined && !normalizedDeliveryStatus) {
    throw createServiceError(
      400,
      'deliveryStatus ?낅젰?댁＜?몄슂. (ORDERED, PREPARING, SHIPPED, DELIVERED, CANCELED)',
    );
  }

  const hasUpdate = [
    deliveryStatus !== undefined,
    courier !== undefined,
    courierCode !== undefined,
    trackingNumber !== undefined,
  ].some(Boolean);

  if (!hasUpdate) {
    throw createServiceError(
      400,
      'deliveryStatus/courier/courierCode/trackingNumber 媛? 媛? ?ㅽ듬?먭슂?댄利좎꽭?꾨쾡.',
    );
  }

  const setClauses = [];
  const values = [];

  if (deliveryStatus !== undefined) {
    values.push(normalizedDeliveryStatus);
    setClauses.push(`delivery_status = $${values.length}`);

    if (normalizedDeliveryStatus === 'SHIPPED') {
      values.push(new Date());
      setClauses.push(`shipped_at = COALESCE(shipped_at, $${values.length}::timestamp)`);
    }

    if (normalizedDeliveryStatus === 'DELIVERED') {
      values.push(new Date());
      setClauses.push(`delivered_at = COALESCE(delivered_at, $${values.length}::timestamp)`);
    }
  }

  if (courier !== undefined) {
    values.push(courier);
    setClauses.push(`courier = $${values.length}`);
  }

  if (courierCode !== undefined) {
    values.push(courierCode);
    setClauses.push(`courier_code = $${values.length}`);
  }

  if (trackingNumber !== undefined) {
    values.push(trackingNumber);
    setClauses.push(`tracking_number = $${values.length}`);
  }

  const { rows: updatedRows } = await pool.query(
    `
      UPDATE orders
      SET
        ${setClauses.join(',\n        ')},
        updated_at = CURRENT_TIMESTAMP
      WHERE order_id = $${values.length + 1}
        AND funding_id = $${values.length + 2}
      RETURNING
        order_id,
        funding_id,
        user_id,
        recipient_name,
        recipient_phone,
        shipping_address,
        shipping_detail_address,
        postal_code,
        total_amount,
        order_status,
        delivery_status,
        courier,
        courier_code,
        tracking_number,
        shipped_at,
        delivered_at,
        created_at
    `,
    [
      ...values,
      normalizedOrderId,
      funding.fundingId,
    ],
  );

  const updated = updatedRows[0];
  if (!updated) {
    throw createServiceError(
      404,
      '二쇰Ц ?댁쾦 ?닿쨷 ?낅젰?댁＜?몄슂.',
      `order_id=${normalizedOrderId}, funding_id=${funding.fundingId}`,
    );
  }

  const { rows: paymentRows } = await pool.query(
    `
      SELECT payment_status
      FROM payments
      WHERE order_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [normalizedOrderId],
  );

  updated.payment_status = paymentRows[0]?.payment_status || updated.order_status;

  const { rows: nicknameRows } = await pool.query(
    `
      SELECT nickname
      FROM users
      WHERE user_id = $1
      LIMIT 1
    `,
    [updated.user_id],
  );

  updated.nickname = nicknameRows[0]?.nickname || null;

  const order = mapBreweryFundingOrderDelivery(updated);
  return {
    ...order,
    paymentStatus: updated.payment_status || order.orderStatus,
  };
};

const upsertBreweryFundingDeliveryByUserId = async ({
  userId,
  fundingId,
  courier,
  trackingNumber,
}) => {
  const funding = await getBreweryOwnedFundingForDashboard({ userId, fundingId });

  if (!funding.isCompleted) {
    throw createServiceError(
      400,
      '종료된 펀딩만 배송 정보를 저장할 수 있습니다.',
      `funding_id=${funding.fundingId}, status=${funding.status}`,
    );
  }

  const { rows } = await pool.query(
    `
      INSERT INTO funding_deliveries (
        funding_id,
        brewery_user_id,
        courier,
        tracking_number,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (funding_id) DO UPDATE
      SET
        brewery_user_id = EXCLUDED.brewery_user_id,
        courier = EXCLUDED.courier,
        tracking_number = EXCLUDED.tracking_number,
        updated_at = CURRENT_TIMESTAMP
      RETURNING
        funding_id,
        courier,
        tracking_number,
        updated_at
    `,
    [
      funding.fundingId,
      Number(userId),
      courier,
      trackingNumber,
    ],
  );

  return mapFundingDelivery(rows[0], funding.fundingId);
};

const getBreweryInsightByUserId = async ({ userId, period }) => {
  await assertBreweryDashboardUser(userId);

  const normalizedPeriod = normalizeBreweryInsightPeriod(period);
  const { startDate, endDate } = getBreweryInsightPeriodRange(normalizedPeriod);

  const [
    postTrendResult,
    fundingSuccessResult,
    btiKeywordResult,
  ] = await Promise.all([
    pool.query(
      `
        SELECT
          recipe_metrics.keyword,
          COUNT(*)::int AS post_count,
          COALESCE(SUM(recipe_metrics.like_count), 0)::int AS likes,
          COALESCE(SUM(recipe_metrics.comment_count), 0)::int AS comments,
          0::int AS views
        FROM (
          SELECT
            r.recipe_id,
            BTRIM(r.main_ingredient) AS keyword,
            COALESCE(r.interest_count, 0)::int AS like_count,
            COUNT(rc.comment_id)::int AS comment_count
          FROM recipes r
          LEFT JOIN recipe_comments rc ON rc.recipe_id = r.recipe_id
          WHERE r.created_at >= $1::date
            AND r.created_at < $2::date
            AND UPPER(COALESCE(r.status, 'PUBLISHED')) = 'PUBLISHED'
            AND NULLIF(BTRIM(r.main_ingredient), '') IS NOT NULL
          GROUP BY
            r.recipe_id,
            BTRIM(r.main_ingredient),
            r.interest_count
        ) recipe_metrics
        GROUP BY recipe_metrics.keyword
        ORDER BY
          likes DESC,
          comments DESC,
          post_count DESC,
          recipe_metrics.keyword ASC
        LIMIT 10
      `,
      [startDate, endDate],
    ),
    pool.query(
      `
        SELECT
          fp.funding_id,
          fp.title,
          fp.current_amount,
          fp.goal_amount,
          fp.status,
          COALESCE(NULLIF(BTRIM(fd.main_ingredient), ''), NULLIF(BTRIM(r.main_ingredient), ''))
            AS main_ingredient,
          COALESCE(NULLIF(BTRIM(fd.sub_ingredients::text), ''), NULLIF(BTRIM(r.ai_sub_ingredient), ''))
            AS sub_ingredients,
          NULLIF(BTRIM(fd.raw_materials::text), '') AS raw_materials,
          tp.sweetness,
          tp.acidity,
          tp.body,
          tp.carbonation,
          tp.alcohol_intensity
        FROM funding_projects fp
        JOIN recipes r ON r.recipe_id = fp.recipe_id
        LEFT JOIN LATERAL (
          SELECT
            main_ingredient,
            sub_ingredients,
            raw_materials
          FROM funding_drafts
          WHERE funding_id = fp.funding_id
            AND brewery_id = fp.brewery_user_id
          ORDER BY updated_at DESC, draft_id DESC
          LIMIT 1
        ) fd ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            sweetness,
            acidity,
            body,
            carbonation,
            alcohol_intensity
          FROM taste_profiles
          WHERE funding_id = fp.funding_id
          ORDER BY updated_at DESC, created_at DESC, taste_profile_id DESC
          LIMIT 1
        ) tp ON TRUE
        WHERE fp.brewery_user_id = $1
          AND UPPER(fp.status) = ANY($2::text[])
          AND fp.end_date >= $3::date
          AND fp.end_date < $4::date
        ORDER BY fp.end_date DESC, fp.funding_id DESC
        LIMIT 20
      `,
      [
        userId,
        BREWERY_INSIGHT_SUCCESS_STATUSES,
        startDate,
        endDate,
      ],
    ),
    pool.query(
      `
        WITH latest_results AS (
          SELECT DISTINCT ON (r.user_id)
            r.user_id,
            t.type_code,
            r.sweetness_score,
            r.body_score,
            r.carbonation_score,
            r.flavor_score,
            r.abv_score
          FROM sul_bti_results r
          JOIN sul_bti_types t ON t.type_id = r.type_id
          WHERE r.created_at >= $1::date
            AND r.created_at < $2::date
          ORDER BY r.user_id, r.created_at DESC, r.result_id DESC
        )
        SELECT
          type_code AS bti_code,
          COUNT(*)::int AS user_count,
          AVG(sweetness_score)::numeric(10, 2) AS avg_sweetness,
          AVG(body_score)::numeric(10, 2) AS avg_body,
          AVG(carbonation_score)::numeric(10, 2) AS avg_carbonation,
          AVG(flavor_score)::numeric(10, 2) AS avg_flavor,
          AVG(abv_score)::numeric(10, 2) AS avg_abv
        FROM latest_results
        GROUP BY type_code
        ORDER BY user_count DESC, type_code ASC
      `,
      [startDate, endDate],
    ),
  ]);

  const postTrends = postTrendResult.rows.map((row) => ({
    keyword: row.keyword,
    post_count: Number(row.post_count || 0),
    likes: Number(row.likes || 0),
    comments: Number(row.comments || 0),
    views: Number(row.views || 0),
  }));
  const fundingSuccess = fundingSuccessResult.rows.map((row) => {
    const currentAmount = Number(row.current_amount || 0);
    const targetAmount = Number(row.goal_amount || 0);

    return {
      name: row.title,
      achieved_pct: targetAmount > 0
        ? Math.round((currentAmount / targetAmount) * 10000) / 100
        : 0,
      status: 'success',
      ingredients: buildFundingInsightIngredients(row),
      taste_vector: buildFundingInsightTasteVector(row),
    };
  });
  const btiKeywords = btiKeywordResult.rows.map((row) => ({
    bti_code: row.bti_code,
    user_count: Number(row.user_count || 0),
    top_keywords: buildBtiInsightKeywords(row),
  }));
  const insightInput = {
    brewery_id: String(userId),
    period: normalizedPeriod,
    post_trends: postTrends,
    funding_success: fundingSuccess,
    bti_keywords: btiKeywords,
  };
  const insight = await requestBreweryInsight(insightInput);

  return {
    period: normalizedPeriod,
    input: {
      post_trends: postTrends,
      funding_success: fundingSuccess,
      bti_keywords: btiKeywords,
    },
    insight,
  };
};

const getBreweryNotificationsByUserId = async (userId) => {
  await assertBreweryDashboardUser(userId);
  const eventSelect = await getBreweryNotificationEventSelect();

  const { rows } = await pool.query(
    `
      SELECT
        notification_id,
        user_id,
        type,
        title,
        content,
        link_url,
        image_url,
        ${eventSelect}
        is_read,
        created_at
      FROM brewery_dashboard_notifications
      WHERE user_id = $1
      ORDER BY created_at DESC, notification_id DESC
    `,
    [userId],
  );

  return rows.map(mapBreweryNotification);
};

const markBreweryNotificationRead = async ({ userId, notificationId }) => {
  await assertBreweryDashboardUser(userId);
  const eventSelect = await getBreweryNotificationEventSelect();

  const { rows } = await pool.query(
    `
      UPDATE brewery_dashboard_notifications
      SET
        is_read = TRUE,
        read_at = COALESCE(read_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
      WHERE notification_id = $1
        AND user_id = $2
      RETURNING
        notification_id,
        type,
        title,
        content,
        link_url,
        image_url,
        ${eventSelect}
        is_read,
        created_at
    `,
    [notificationId, userId],
  );

  if (rows.length === 0) {
    throw createServiceError(
      404,
      '알림을 찾을 수 없습니다.',
      `notification_id=${notificationId}, user_id=${userId}`,
    );
  }

  return mapBreweryNotification(rows[0]);
};

const markAllBreweryNotificationsRead = async (userId) => {
  await assertBreweryDashboardUser(userId);

  const { rows } = await pool.query(
    `
      UPDATE brewery_dashboard_notifications
      SET
        is_read = TRUE,
        read_at = COALESCE(read_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
        AND is_read = FALSE
      RETURNING notification_id
    `,
    [userId],
  );

  return {
    updatedCount: rows.length,
  };
};

module.exports = {
  createApplication,
  getApplications,
  getApplicationByUserId,
  approveApplication,
  rejectApplication: rejectApplicationWithRoleUpdate,
  updateApprovedApplicationByUserId,
  getBreweryProfileByUserId,
  getBreweryDashboardBasicInfoByUserId,
  updateBreweryProfileByUserId,
  uploadBreweryProfileImageByUserId,
  getBreweryFundingSummaryByUserId,
  getBreweryDashboardFundingsByUserId,
  getBreweryFundingDeliveryByUserId,
  upsertBreweryFundingDeliveryByUserId,
  getBreweryFundingOrdersByUserId,
  updateBreweryFundingOrderDeliveryByUserId,
  getBreweryInsightByUserId,
  getBreweryNotificationsByUserId,
  markBreweryNotificationRead,
  markAllBreweryNotificationsRead,
};
