const pool = require('../config/db');
const {
  registerFundingProjectToAiPool,
} = require('../services/funding.service');
const {
  createFundingCreatedNotification,
  createSettlementCompletedNotification,
} = require('../services/breweryDashboardNotification.service');
const { settleExpiredFundings } = require('../services/fundingSettlement.service');
const {
  getLawReviewQueue,
  getLawReviewDetail,
  updateLawReviewStatus,
} = require('../services/lawReview.service');
const { restoreRecipeStatusAfterVoidedFunding } = require('../services/recipeService');

// 관리자 제출 프로젝트 목록 조회
const getAdminUserId = (req) => {
  const rawUserId = req.user?.userId || req.user?.id || req.user?.user_id || null;
  const userId = Number(rawUserId);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
};

const ADMIN_FUNDING_REVIEW_STATUSES = ['SUBMITTED', 'REVIEWING', 'APPROVED', 'REJECTED'];
const ADMIN_FUNDING_REPORT_STATUSES = ['PENDING', 'REVIEWED', 'RESOLVED', 'REJECTED'];
const ADMIN_FUNDING_REPORT_BAD_STATUS_MESSAGE = '신고 상태는 PENDING, REVIEWED, RESOLVED, REJECTED 중 하나여야 합니다.';

const normalizeAdminFundingReportStatus = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim().toUpperCase();

  if (!normalized) {
    return null;
  }

  return ADMIN_FUNDING_REPORT_STATUSES.includes(normalized) ? normalized : null;
};

const getAdminFundingReportTableName = async () => 'funding_reports';

const mapAdminFundingReport = (row) => ({
  reportId: Number(row.report_id),
  fundingId: row.funding_id === null || row.funding_id === undefined
    ? null
    : Number(row.funding_id),
  fundingTitle: row.funding_title || null,
  reporterId: row.reporter_id === null || row.reporter_id === undefined
    ? null
    : Number(row.reporter_id),
  reporterNickname: row.reporter_nickname || null,
  reason: row.reason,
  content: row.content || null,
  status: row.status,
  adminMemo: row.admin_memo || null,
  reviewedAt: row.reviewed_at || null,
  reviewedBy: row.reviewed_by === null || row.reviewed_by === undefined
    ? null
    : Number(row.reviewed_by),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toNullableNumber = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const parseJsonField = (value, fallback = []) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
};

const toTrimmedString = (value) => {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
};

const uniqueStrings = (values) => [
  ...new Set(
    (values || [])
      .map((value) => toTrimmedString(value))
      .filter(Boolean)
  ),
];

const parseListField = (value, fallback = []) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (Array.isArray(value)) {
    return uniqueStrings(value);
  }

  if (typeof value === 'string') {
    try {
      return parseListField(JSON.parse(value), fallback);
    } catch (error) {
      return uniqueStrings(value.split(','));
    }
  }

  return fallback;
};

const parseOriginalTextField = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
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

const parseRawMaterialsField = (value, fallback = []) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (Array.isArray(value)) {
    const materials = value.map(normalizeRawMaterialItem).filter(Boolean);
    return materials.length > 0 ? materials : fallback;
  }

  if (typeof value === 'string') {
    try {
      return parseRawMaterialsField(JSON.parse(value), fallback);
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

const buildImageFields = (thumbnailUrl, imageUrlsValue) => {
  const imageUrls = parseListField(imageUrlsValue, []);
  const thumbnail = toTrimmedString(thumbnailUrl) || imageUrls[0] || null;
  const allImageUrls = uniqueStrings([thumbnail, ...imageUrls]);

  return {
    thumbnailUrl: thumbnail,
    imageUrls,
    allImageUrls,
  };
};

const parseTasteExtras = (flavorNotesValue) => {
  const parsed = parseJsonField(flavorNotesValue, []);

  if (Array.isArray(parsed)) {
    return {
      flavorNotes: parsed,
      flavorTags: parsed,
      finish: null,
      aftertaste: null,
      flavor: null,
      aromaIntensity: null,
      tasteInput: null,
      tasteVector: null,
    };
  }

  if (parsed && typeof parsed === 'object') {
    return {
      flavorNotes: parseListField(parsed.flavorNotes || parsed.flavor_notes || parsed.flavorTags || parsed.flavor_tags),
      flavorTags: parseListField(parsed.flavorTags || parsed.flavor_tags || parsed.flavorNotes || parsed.flavor_notes),
      finish: toNullableNumber(parsed.finish ?? parsed.aftertaste),
      aftertaste: toNullableNumber(parsed.aftertaste ?? parsed.finish),
      flavor: toNullableNumber(parsed.flavor),
      aromaIntensity: toNullableNumber(parsed.aromaIntensity ?? parsed.aroma_intensity),
      tasteInput: parsed.tasteInput || parsed.taste_input || null,
      tasteVector: parsed.tasteVector || parsed.taste_vector || null,
    };
  }

  return {
    flavorNotes: [],
    flavorTags: [],
    finish: null,
    aftertaste: null,
    flavor: null,
    aromaIntensity: null,
    tasteInput: null,
    tasteVector: null,
  };
};

const buildAdminTasteProfile = (draft = {}) => {
  const extras = parseTasteExtras(draft.flavor_notes);

  return {
    sweetness: draft.sweetness,
    acidity: draft.acidity,
    body: draft.body,
    carbonation: draft.carbonation,
    alcoholIntensity: draft.alcohol_intensity,
    alcoholPercentage: draft.alcohol_percentage,
    alcohol: draft.alcohol_intensity,
    aftertaste: extras.aftertaste ?? extras.finish,
    finish: extras.finish ?? extras.aftertaste,
    flavor: extras.flavor,
    aromaIntensity: extras.aromaIntensity,
    flavorNotes: extras.flavorNotes,
    flavorTags: extras.flavorTags,
    tasteInput: extras.tasteInput,
    tasteVector: extras.tasteVector,
  };
};

const mapAdminFundingDocument = (document) => ({
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

const mapAdminSupportOption = (option) => ({
  optionId: Number(option.option_id),
  name: option.name,
  price: Number(option.price || 0),
  description: option.description,
  volume: option.volume,
  alcohol: option.alcohol,
  alcoholPercentage: option.alcohol_percentage ?? option.alcohol,
  stock: option.stock,
  remainingStock: option.remaining_stock,
  maxPerUser: option.max_per_user,
});

const selectProjectPolicyText = (refundPolicy, exchangePolicy) => {
  const refund = parseOriginalTextField(refundPolicy);
  const exchange = parseOriginalTextField(exchangePolicy);

  if (refund && exchange && refund === exchange) {
    return refund;
  }

  return refund || exchange || null;
};

const buildAdminFundingDraftPayload = ({ draft, documents = [], supportOptions = [] }) => {
  const imageFields = buildImageFields(draft.thumbnail_url, draft.image_urls);
  const subIngredients = parseListField(draft.sub_ingredients, []);
  const tags = parseJsonField(draft.tags, []);
  const rawMaterials = parseRawMaterialsField(draft.raw_materials, []);
  const budgetPlan = parseOriginalTextField(draft.budget_plan);
  const schedulePlan = parseOriginalTextField(draft.schedule_plan);
  const projectPolicy = selectProjectPolicyText(draft.refund_policy, draft.exchange_policy);
  const tasteProfile = buildAdminTasteProfile(draft);
  const tasteGraph = {
    sweetness: tasteProfile.sweetness,
    aftertaste: tasteProfile.aftertaste,
    finish: tasteProfile.finish,
    acidity: tasteProfile.acidity,
    body: tasteProfile.body,
    carbonation: tasteProfile.carbonation,
  };
  const legalNoticeSource = rawMaterials.length > 0
    ? rawMaterials
    : (draft.volume || draft.alcohol_percentage || draft.main_ingredient
      ? [{ name: draft.main_ingredient || null, origin: null }]
      : []);
  const legalNotices = legalNoticeSource.map((material) => ({
    volume: draft.volume ?? '',
    alcoholDegree: draft.alcohol_percentage ?? null,
    alcoholContent: draft.alcohol_percentage ?? null,
    mainIngredient: material.name || material.mainIngredient || material.main_ingredient || draft.main_ingredient || '',
    origin: material.origin || material.countryOfOrigin || material.country_of_origin || material.region || '',
  }));
  const fundingStatus = draft.funding_status || null;

  return {
    draftId: Number(draft.draft_id),
    fundingId: draft.funding_id === null || draft.funding_id === undefined
      ? null
      : Number(draft.funding_id),
    draftStatus: draft.status,
    fundingStatus,
    status: draft.status,
    rejectionReason: draft.reject_reason || null,
    rejectReason: draft.reject_reason || null,
    submittedAt: draft.submitted_at || null,
    reviewedAt: draft.reviewed_at || null,
    reviewedBy: draft.reviewed_by === null || draft.reviewed_by === undefined
      ? null
      : Number(draft.reviewed_by),
    basicInfo: {
      title: draft.title,
      shortTitle: draft.short_title,
      mainIngredient: draft.main_ingredient,
      subIngredients,
      alcoholDegree: draft.alcohol_percentage,
      alcoholContent: draft.alcohol_percentage,
      alcoholPercentage: draft.alcohol_percentage,
      summary: draft.summary,
      projectSummary: draft.summary,
      thumbnailUrl: imageFields.thumbnailUrl,
      representativeImageUrl: imageFields.thumbnailUrl,
      imageUrls: imageFields.imageUrls,
      allImageUrls: imageFields.allImageUrls,
      searchTags: tags,
      tags,
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
    legalNotices,
    tasteProfile,
    tasteGraph,
    storyInfo: {
      introduction: draft.introduction,
      projectDescription: draft.introduction,
      budgetPlan,
      projectBudget: budgetPlan,
      videoUrl: draft.video_url,
      projectSchedule: schedulePlan,
      schedulePlan,
    },
    breweryInfo: {
      breweryId: Number(draft.brewery_id),
      breweryName: draft.brewery_name,
      breweryDescription: draft.creator_introduction,
      creatorName: draft.creator_name,
      profileImageUrl: draft.profile_image_url,
      creatorIntroduction: draft.creator_introduction,
      representativeName: draft.representative_name,
      businessRegistrationNumber: draft.business_registration_number,
      businessAddress: draft.business_address,
      businessAddressDetail: draft.business_address_detail,
      contactEmail: draft.contact_email,
      contactPhone: draft.contact_phone,
      bankName: draft.bank_name,
      accountNumber: draft.account_number,
      accountHolder: draft.account_holder,
      accountVerified: draft.account_verified,
      phoneVerified: draft.phone_verified,
      identityDocumentUrl: draft.identity_document_url,
    },
    taxInvoiceInfo: {
      businessClassification: draft.business_classification || null,
      businessType: draft.business_type || null,
      companyName: draft.business_name || null,
      businessName: draft.business_name || null,
      businessRegistrationNumber: draft.business_registration_number || null,
      representativeName: draft.representative_name || null,
      businessAddress: draft.business_address || null,
      businessCategory: draft.business_category || null,
      businessItem: draft.business_item || null,
      email: draft.tax_email || null,
      taxEmail: draft.tax_email || null,
      businessRegistrationFileUrl: draft.business_registration_file_url || null,
    },
    noticeInfo: {
      projectPolicy,
      policy: projectPolicy,
      expectedDifficulties: draft.risk_notice || null,
      risks: draft.risk_notice || null,
      riskPlan: draft.risk_notice || null,
      riskNotice: draft.risk_notice || null,
    },
    supportOptions,
    documents: documents.map(mapAdminFundingDocument),
  };
};

const getSubmittedFundingDraftsLegacy = async (req, res) => {
  const REVIEW_TARGET_DRAFT_STATUSES = ['SUBMITTED', 'REVIEWING'];
  const EXCLUDED_PROJECT_STATUSES = [
    'READY',
    'APPROVED',
    'ACTIVE',
    'SUCCESS',
    'FAILED',
    'ENDED',
    'ONGOING',
    'REJECTED',
    'CANCELED',
    'CANCELLED',
  ];
  const { status } = req.query;

  const requestedStatuses = status
    ? (Array.isArray(status) ? status : String(status).split(','))
      .map((value) => String(value).trim().toUpperCase())
      .filter(Boolean)
    : REVIEW_TARGET_DRAFT_STATUSES;

  const statuses = [...new Set(requestedStatuses)];
  const hasInvalidStatus = statuses.some(
    (value) => !REVIEW_TARGET_DRAFT_STATUSES.includes(value),
  );

  if (statuses.length === 0 || hasInvalidStatus) {
    return res.status(400).json({
      status: 400,
      message: '심사 목록은 SUBMITTED 또는 REVIEWING 상태만 조회할 수 있습니다.',
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        fd.draft_id AS "draftId",
        fd.funding_id AS "fundingId",
        fd.title,
        COALESCE(
          NULLIF(fd.brewery_name, ''),
          NULLIF(fd.business_name, ''),
          u.nickname
        ) AS "breweryName",
        fd.status,
        fd.submitted_at AS "submittedAt",
        fd.created_at AS "createdAt"
      FROM funding_drafts fd
      LEFT JOIN funding_projects fp ON fp.funding_id = fd.funding_id
      LEFT JOIN users u ON u.user_id = fd.brewery_id
      WHERE fd.status = ANY($1::text[])
        AND (
          fp.funding_id IS NULL
          OR fp.status IS NULL
          OR fp.status <> ALL($2::text[])
        )
      ORDER BY fd.submitted_at DESC NULLS LAST, fd.created_at DESC
      `,
      [statuses, EXCLUDED_PROJECT_STATUSES]
    );

    return res.status(200).json({
      status: 200,
      drafts: result.rows,
      message: '관리자 펀딩 심사 목록 조회 성공',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '관리자 펀딩 심사 목록 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const getSubmittedFundingDrafts = async (req, res) => {
  const { status } = req.query;
  const requestedStatuses = status
    ? (Array.isArray(status) ? status : String(status).split(','))
      .map((value) => String(value).trim().toUpperCase())
      .filter(Boolean)
    : ADMIN_FUNDING_REVIEW_STATUSES;
  const statuses = [...new Set(requestedStatuses)];
  const hasInvalidStatus = statuses.some(
    (value) => !ADMIN_FUNDING_REVIEW_STATUSES.includes(value),
  );

  if (statuses.length === 0 || hasInvalidStatus) {
    return res.status(400).json({
      status: 400,
      message: '펀딩 심사 목록은 SUBMITTED, REVIEWING, APPROVED, REJECTED 상태만 조회할 수 있습니다.',
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        fd.draft_id AS "draftId",
        fd.funding_id AS "fundingId",
        fd.title,
        COALESCE(
          NULLIF(fd.brewery_name, ''),
          NULLIF(fd.business_name, ''),
          u.nickname
        ) AS "breweryName",
        u.nickname AS "applicantName",
        fd.representative_name AS "representativeName",
        fd.status,
        fd.status AS "draftStatus",
        fp.status AS "fundingStatus",
        fd.target_amount AS "targetAmount",
        fd.funding_start_date AS "startDate",
        fd.funding_end_date AS "endDate",
        fd.submitted_at AS "submittedAt",
        fd.reviewed_at AS "reviewedAt",
        fd.reject_reason AS "rejectionReason",
        fd.thumbnail_url AS "thumbnailUrl",
        fd.created_at AS "createdAt"
      FROM funding_drafts fd
      LEFT JOIN funding_projects fp ON fp.funding_id = fd.funding_id
      LEFT JOIN users u ON u.user_id = fd.brewery_id
      WHERE fd.status = ANY($1::text[])
      ORDER BY fd.submitted_at DESC NULLS LAST, fd.created_at DESC
      `,
      [statuses],
    );

    return res.status(200).json({
      status: 200,
      drafts: result.rows,
      data: result.rows,
      message: '관리자 펀딩 심사 목록 조회 성공',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '관리자 펀딩 심사 목록 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const getFundingDraftReviewDetail = async (req, res) => {
  const { draftId } = req.params;

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '펀딩 임시저장 ID가 올바르지 않습니다.',
    });
  }

  try {
    const draftResult = await pool.query(
      `
      SELECT
        fd.*,
        fp.status AS funding_status,
        fp.current_amount,
        fp.supporter_count,
        u.nickname AS applicant_name,
        u.email AS applicant_email
      FROM funding_drafts fd
      LEFT JOIN funding_projects fp ON fp.funding_id = fd.funding_id
      LEFT JOIN users u ON u.user_id = fd.brewery_id
      WHERE fd.draft_id = $1
      LIMIT 1
      `,
      [Number(draftId)],
    );

    if (draftResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩 심사 대상을 찾을 수 없습니다.',
      });
    }

    const draft = draftResult.rows[0];
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
      [Number(draftId)],
    );

    let supportOptions = [];

    if (draft.funding_id) {
      const optionResult = await pool.query(
        `
        SELECT
          option_id,
          name,
          price,
          description,
          volume,
          alcohol,
          alcohol_percentage,
          stock,
          remaining_stock,
          max_per_user
        FROM funding_support_options
        WHERE funding_id = $1
        ORDER BY option_id ASC
        `,
        [Number(draft.funding_id)],
      );
      supportOptions = optionResult.rows.map(mapAdminSupportOption);
    }

    if (supportOptions.length === 0 && draft.price_per_bottle) {
      supportOptions = [{
        optionId: null,
        name: draft.short_title || draft.title || '기본 후원 옵션',
        price: Number(draft.price_per_bottle || 0),
        description: draft.summary || draft.introduction || null,
        volume: draft.volume || null,
        alcohol: draft.alcohol_percentage || null,
        alcoholPercentage: draft.alcohol_percentage || null,
        stock: draft.total_quantity || null,
        remainingStock: draft.total_quantity || null,
        maxPerUser: null,
        generated: true,
      }];
    }

    const data = buildAdminFundingDraftPayload({
      draft,
      documents: documentResult.rows,
      supportOptions,
    });

    return res.status(200).json({
      status: 200,
      data,
      ...data,
      message: '관리자 펀딩 심사 상세 조회 성공',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '관리자 펀딩 심사 상세 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const toPositiveInteger = (value, fallback = null) => {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return fallback;
  }

  return Math.floor(numberValue);
};

const buildDefaultSupportOptionName = (draft, funding) => {
  const baseName = String(
    draft.reward_name ||
    draft.option_name ||
    draft.short_title ||
    draft.title ||
    funding.title ||
    '기본 후원 옵션'
  ).trim().replace(/\s+/g, ' ');
  const normalizedBaseName = baseName.replace(/(?:\s*기본\s*후원)+$/u, '').trim();
  const optionName = normalizedBaseName && normalizedBaseName !== '기본 후원 옵션'
    ? `${normalizedBaseName} 기본 후원`
    : '기본 후원 옵션';

  return optionName.slice(0, 100);
};

const ensureDefaultFundingSupportOption = async (client, funding, draft) => {
  const fundingId = Number(funding?.funding_id || draft?.funding_id);

  if (!Number.isInteger(fundingId) || fundingId <= 0) {
    return null;
  }

  const existingOptionResult = await client.query(
    `
    SELECT option_id
    FROM funding_support_options
    WHERE funding_id = $1
    LIMIT 1
    `,
    [fundingId]
  );

  if (existingOptionResult.rows.length > 0) {
    return null;
  }

  const projectResult = await client.query(
    `
    SELECT
      funding_id,
      title,
      price_per_bottle,
      summary,
      description
    FROM funding_projects
    WHERE funding_id = $1
    LIMIT 1
    `,
    [fundingId]
  );
  const project = projectResult.rows[0] || funding || {};
  const price = toPositiveInteger(draft.price_per_bottle, toPositiveInteger(project.price_per_bottle));

  if (!price) {
    const error = new Error('후원 옵션 생성을 위한 가격 정보가 없습니다.');
    error.status = 400;
    throw error;
  }

  const stock = toPositiveInteger(
    draft.total_quantity || draft.stock || draft.target_quantity,
    100
  );
  const maxPerUser = toPositiveInteger(draft.max_per_user || draft.maxPerUser, 10);
  const optionName = buildDefaultSupportOptionName(draft, project);
  const description =
    draft.reward_description ||
    draft.option_description ||
    draft.summary ||
    project.summary ||
    project.description ||
    optionName;

  const createdOptionResult = await client.query(
    `
    INSERT INTO funding_support_options (
      funding_id,
      name,
      price,
      description,
      stock,
      remaining_stock,
      max_per_user
    )
    VALUES ($1, $2, $3, $4, $5, $5, $6)
    RETURNING option_id
    `,
    [
      fundingId,
      optionName,
      price,
      description,
      stock,
      maxPerUser,
    ]
  );

  console.log('Default funding support option created', {
    fundingId,
    draftId: draft.draft_id,
    optionId: createdOptionResult.rows[0]?.option_id,
  });

  return createdOptionResult.rows[0] || null;
};

// 관리자 제출 프로젝트 승인
const approveFundingDraft = async (req, res) => {
  const { draftId } = req.params;
  const adminUserId = getAdminUserId(req);

  if (!adminUserId) {
    return res.status(401).json({
      status: 401,
      message: '관리자 사용자 정보를 확인할 수 없습니다.',
    });
  }

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청입니다.',
    });
  }

  try {
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
        message: '제출 프로젝트를 찾을 수 없습니다.',
      });
    }

    const draft = draftResult.rows[0];

    if (!['SUBMITTED', 'REVIEWING'].includes(draft.status)) {
      return res.status(400).json({
        status: 400,
        message: '심사 중인 펀딩만 승인할 수 있습니다.',
      });
    }

    const client = await pool.connect();
    let funding;
    let approvedDraft;

    try {
      await client.query('BEGIN');

      if (draft.funding_id) {
        const fundingResult = await client.query(
          `
          UPDATE funding_projects
          SET
            title = COALESCE($1, title),
            description = COALESCE($2, description),
            goal_amount = COALESCE($3, goal_amount),
            start_date = COALESCE($4, start_date),
            end_date = COALESCE($5, end_date),
            status = 'ACTIVE',
            summary = COALESCE($6, summary),
            category = COALESCE($7, category),
            thumbnail_url = COALESCE($8, thumbnail_url),
            image_urls = COALESCE($9, image_urls),
            expected_delivery_date = COALESCE($10, expected_delivery_date),
            price_per_bottle = COALESCE($11, price_per_bottle),
            shipping_fee = COALESCE($12, shipping_fee),
            volume = COALESCE($13, volume),
            alcohol_percentage = COALESCE($14, alcohol_percentage),
            budget_plan = COALESCE($15, budget_plan),
            schedule_plan = COALESCE($16, schedule_plan),
            refund_policy = COALESCE($17, refund_policy),
            exchange_policy = COALESCE($18, exchange_policy),
            creator_introduction = COALESCE($19, creator_introduction),
            updated_at = CURRENT_TIMESTAMP
          WHERE funding_id = $20
          RETURNING
            funding_id,
            title,
            status,
            created_at
          `,
          [
            draft.title,
            draft.summary || draft.introduction || null,
            draft.target_amount !== null && draft.target_amount !== undefined
              ? Number(draft.target_amount)
              : null,
            draft.funding_start_date,
            draft.funding_end_date,
            draft.summary || null,
            draft.category || null,
            draft.thumbnail_url || null,
            draft.image_urls || null,
            draft.expected_delivery_date || null,
            draft.price_per_bottle !== null && draft.price_per_bottle !== undefined
              ? Number(draft.price_per_bottle)
              : null,
            draft.shipping_fee !== null && draft.shipping_fee !== undefined
              ? Number(draft.shipping_fee)
              : null,
            draft.volume !== null && draft.volume !== undefined ? Number(draft.volume) : null,
            draft.alcohol_percentage !== null && draft.alcohol_percentage !== undefined
              ? Number(draft.alcohol_percentage)
              : null,
            draft.budget_plan || null,
            draft.schedule_plan || null,
            draft.refund_policy || null,
            draft.exchange_policy || null,
            draft.creator_introduction || null,
            Number(draft.funding_id),
          ]
        );

        funding = fundingResult.rows[0];
      }

      if (!funding) {
        const recipeId = draft.recipe_id || 3;
        const fundingResult = await client.query(
          `
          INSERT INTO funding_projects (
            recipe_id,
            brewery_user_id,
            title,
            description,
            goal_amount,
            current_amount,
            start_date,
            end_date,
            status,
            summary,
            category,
            thumbnail_url,
            image_urls,
            expected_delivery_date,
            price_per_bottle,
            shipping_fee,
            volume,
            alcohol_percentage,
            budget_plan,
            schedule_plan,
            refund_policy,
            exchange_policy,
            creator_introduction
          )
          VALUES (
            $1, $2, $3, $4, $5, 0, $6, $7, 'ACTIVE', $8, $9, $10, $11,
            $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
          )
          RETURNING
            funding_id,
            title,
            status,
            created_at
          `,
          [
            recipeId,
            Number(draft.brewery_id),
            draft.title,
            draft.summary || draft.introduction || '',
            Number(draft.target_amount || 0),
            draft.funding_start_date,
            draft.funding_end_date,
            draft.summary || null,
            draft.category || null,
            draft.thumbnail_url || null,
            draft.image_urls || '[]',
            draft.expected_delivery_date || null,
            Number(draft.price_per_bottle || 0),
            draft.shipping_fee !== null && draft.shipping_fee !== undefined
              ? Number(draft.shipping_fee)
              : 3000,
            draft.volume !== null && draft.volume !== undefined ? Number(draft.volume) : null,
            draft.alcohol_percentage !== null && draft.alcohol_percentage !== undefined
              ? Number(draft.alcohol_percentage)
              : null,
            draft.budget_plan || null,
            draft.schedule_plan || null,
            draft.refund_policy || null,
            draft.exchange_policy || null,
            draft.creator_introduction || null,
          ]
        );

        funding = fundingResult.rows[0];
      }

      await ensureDefaultFundingSupportOption(client, funding, draft);

      const approvedDraftResult = await client.query(
        `
        UPDATE funding_drafts
        SET
          status = 'APPROVED',
          funding_id = $2,
          reject_reason = NULL,
          reviewed_at = CURRENT_TIMESTAMP,
          reviewed_by = $3,
          updated_at = CURRENT_TIMESTAMP
        WHERE draft_id = $1
        RETURNING draft_id, funding_id, status, reviewed_at, reviewed_by, updated_at
        `,
        [Number(draftId), funding.funding_id, adminUserId]
      );
      approvedDraft = approvedDraftResult.rows[0];

      // 펀딩 승인 시 연결된 원본 레시피를 펀딩 진행중(FUNDING_IN_PROGRESS) 상태로 전이한다.
      // recipe_id가 없으면(레시피 없이 만든 직접 펀딩) 전이 대상이 없으므로 건너뛴다.
      const linkedRecipeId = (draft.recipe_id != null && Number(draft.recipe_id) > 0)
        ? Number(draft.recipe_id)
        : null;
      if (linkedRecipeId) {
        await client.query(
          `
          UPDATE recipes
          SET status = 'FUNDING_IN_PROGRESS', updated_at = CURRENT_TIMESTAMP
          WHERE recipe_id = $1
          `,
          [linkedRecipeId]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    try {
      await createFundingCreatedNotification(funding.funding_id);
    } catch (notificationError) {
      console.warn('Failed to create funding created brewery notification', {
        fundingId: funding.funding_id,
        message: notificationError.message,
      });
    }

    const aiRecommendation = await registerFundingProjectToAiPool(funding.funding_id);

    return res.status(200).json({
      draftId: Number(approvedDraft.draft_id),
      fundingId: Number(funding.funding_id),
      title: funding.title,
      status: funding.status,
      draftStatus: approvedDraft.status,
      fundingStatus: funding.status,
      reviewedAt: approvedDraft.reviewed_at,
      reviewedBy: Number(approvedDraft.reviewed_by),
      createdAt: funding.created_at,
      aiRecommendation,
      message: '프로젝트가 승인되었습니다.',
    });
  } catch (error) {
    console.error(error);
    const status = error.status || 500;

    return res.status(status).json({
      status,
      message: status === 500
        ? '프로젝트 승인 중 서버 오류가 발생했습니다.'
        : error.message,
      error: error.message,
    });
  }
};

// 관리자 제출 프로젝트 반려
const rejectFundingDraft = async (req, res) => {
  const { draftId } = req.params;
  const body = req.body || {};
  const rejectReason = body.rejectReason || body.rejectionReason || body.reason;
  const adminUserId = getAdminUserId(req);

  if (!adminUserId) {
    return res.status(401).json({
      status: 401,
      message: '관리자 사용자 정보를 확인할 수 없습니다.',
    });
  }

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청입니다.',
    });
  }

  if (!rejectReason || typeof rejectReason !== 'string' || rejectReason.trim() === '') {
    return res.status(400).json({
      status: 400,
      message: '반려 사유를 입력해야 합니다.',
    });
  }

  try {
    const draftResult = await pool.query(
      `
      SELECT draft_id, funding_id, status
      FROM funding_drafts
      WHERE draft_id = $1
      `,
      [Number(draftId)]
    );

    if (draftResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '제출 프로젝트를 찾을 수 없습니다.',
      });
    }

    const draft = draftResult.rows[0];

    if (!['SUBMITTED', 'REVIEWING'].includes(draft.status)) {
      return res.status(400).json({
        status: 400,
        message: '심사 중인 프로젝트만 반려할 수 있습니다.',
      });
    }

    const client = await pool.connect();
    let rejectedDraft;
    let rejectedFunding = null;

    try {
      await client.query('BEGIN');

      const result = await client.query(
        `
        UPDATE funding_drafts
        SET
          status = 'REJECTED',
          reject_reason = $1,
          reviewed_at = CURRENT_TIMESTAMP,
          reviewed_by = $3,
          updated_at = CURRENT_TIMESTAMP
        WHERE draft_id = $2
        RETURNING draft_id, funding_id, status, reject_reason, reviewed_at, reviewed_by, updated_at
        `,
        [rejectReason.trim(), Number(draftId), adminUserId]
      );

      rejectedDraft = result.rows[0];

      if (rejectedDraft.funding_id) {
        const fundingResult = await client.query(
          `
          UPDATE funding_projects
          SET
            status = 'REJECTED',
            updated_at = CURRENT_TIMESTAMP
          WHERE funding_id = $1
            AND status IN ('READY', 'REVIEWING', 'SUBMITTED', 'ONGOING')
          RETURNING funding_id, recipe_id, status, updated_at
          `,
          [Number(rejectedDraft.funding_id)]
        );

        rejectedFunding = fundingResult.rows[0] || null;

        // 반려로 펀딩이 무효화되면, 살아있는 다른 펀딩이 없는 한 원본 레시피 상태를 원복한다.
        if (rejectedFunding?.recipe_id) {
          await restoreRecipeStatusAfterVoidedFunding(client, Number(rejectedFunding.recipe_id));
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return res.status(200).json({
      draftId: Number(rejectedDraft.draft_id),
      fundingId: rejectedDraft.funding_id ? Number(rejectedDraft.funding_id) : null,
      status: rejectedDraft.status,
      draftStatus: rejectedDraft.status,
      fundingStatus: rejectedFunding?.status || null,
      projectStatus: rejectedFunding?.status || null,
      rejectReason: rejectedDraft.reject_reason,
      rejectionReason: rejectedDraft.reject_reason,
      reviewedAt: rejectedDraft.reviewed_at,
      reviewedBy: Number(rejectedDraft.reviewed_by),
      updatedAt: rejectedDraft.updated_at,
      message: '프로젝트가 반려되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '프로젝트 반려 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const cancelFundingProject = async (req, res) => {
  const { fundingId } = req.params;
  const { cancelReason } = req.body || {};
  const adminUserId = getAdminUserId(req);

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(400).json({
      status: 400,
      message: '올바른 펀딩 ID가 아닙니다.',
    });
  }

  try {
    const fundingResult = await pool.query(
      `
      SELECT
        funding_id,
        title,
        status,
        current_amount,
        goal_amount
      FROM funding_projects
      WHERE funding_id = $1
      `,
      [Number(fundingId)]
    );

    if (fundingResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '펀딩을 찾을 수 없습니다.',
      });
    }

    const funding = fundingResult.rows[0];
    const currentStatus = String(funding.status || '').trim().toUpperCase();
    const nonCancelableStatuses = ['SUCCESS', 'FAILED', 'ENDED', 'CANCELED', 'CANCELLED'];

    if (nonCancelableStatuses.includes(currentStatus)) {
      return res.status(400).json({
        status: 400,
        message: '이미 종료되었거나 취소된 펀딩은 취소할 수 없습니다.',
      });
    }

    const client = await pool.connect();
    let canceledFunding;

    try {
      await client.query('BEGIN');

      const updateResult = await client.query(
        `
        UPDATE funding_projects
        SET
          status = 'CANCELED',
          updated_at = CURRENT_TIMESTAMP
        WHERE funding_id = $1
        RETURNING
          funding_id,
          recipe_id,
          title,
          status,
          current_amount,
          goal_amount,
          updated_at
        `,
        [Number(fundingId)]
      );

      canceledFunding = updateResult.rows[0];

      // 취소로 펀딩이 무효화되면, 살아있는 다른 펀딩이 없는 한 원본 레시피 상태를 원복한다.
      if (canceledFunding?.recipe_id) {
        await restoreRecipeStatusAfterVoidedFunding(client, Number(canceledFunding.recipe_id));
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    console.log('[funding-cancel] funding canceled by admin', {
      fundingId: Number(canceledFunding.funding_id),
      previousStatus: currentStatus,
      newStatus: canceledFunding.status,
      cancelReason: cancelReason || null,
      adminUserId,
    });

    return res.status(200).json({
      status: 200,
      message: '펀딩이 취소되었습니다.',
      data: {
        fundingId: Number(canceledFunding.funding_id),
        title: canceledFunding.title,
        previousStatus: currentStatus,
        newStatus: canceledFunding.status,
        currentAmount: Number(canceledFunding.current_amount || 0),
        goalAmount: Number(canceledFunding.goal_amount || 0),
        cancelReason: cancelReason || null,
        updatedAt: canceledFunding.updated_at,
      },
    });
  } catch (error) {
    console.error('[funding-cancel] funding cancel failed', error);

    return res.status(500).json({
      status: 500,
      message: '펀딩 취소 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const getFundingReportsForAdmin = async (req, res) => {
  const { status, page = 0, size = 20 } = req.query;
  const normalizedStatus = normalizeAdminFundingReportStatus(status);
  const hasStatusQuery = status !== undefined && status !== null && String(status).trim() !== '';
  const pageNumber = Number(page);
  const sizeNumber = Number(size);

  if (hasStatusQuery && !normalizedStatus) {
    return res.status(400).json({
      status: 400,
      message: ADMIN_FUNDING_REPORT_BAD_STATUS_MESSAGE,
    });
  }

  if (!Number.isInteger(pageNumber) || pageNumber < 0 || !Number.isInteger(sizeNumber) || sizeNumber <= 0) {
    return res.status(400).json({
      status: 400,
      message: '페이지 요청 값이 올바르지 않습니다.',
    });
  }

  try {
    const reportTableName = await getAdminFundingReportTableName();
    const values = [];
    const conditions = [];

    if (normalizedStatus) {
      values.push(normalizedStatus);
      conditions.push(`fr.status = $${values.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total_count FROM ${reportTableName} fr ${whereClause}`,
      values,
    );
    const listValues = [...values, sizeNumber, pageNumber * sizeNumber];

    const { rows } = await pool.query(
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
        fr.admin_memo,
        fr.reviewed_at,
        fr.reviewed_by,
        fr.created_at,
        fr.updated_at
      FROM ${reportTableName} fr
      LEFT JOIN funding_projects fp ON fp.funding_id = fr.funding_id
      LEFT JOIN users u ON u.user_id = fr.reporter_id
      ${whereClause}
      ORDER BY fr.created_at DESC, fr.report_id DESC
      LIMIT $${listValues.length - 1}
      OFFSET $${listValues.length}
      `,
      listValues,
    );

    const totalElements = Number(countResult.rows[0]?.total_count || 0);

    return res.status(200).json({
      status: 200,
      message: '펀딩 신고 목록 조회 성공',
      data: {
        content: rows.map(mapAdminFundingReport),
        page: pageNumber,
        size: sizeNumber,
        totalElements,
        totalPages: Math.ceil(totalElements / sizeNumber),
      },
    });
  } catch (error) {
    console.error('[admin-funding-reports] list failed', error);
    return res.status(500).json({
      status: 500,
      message: '펀딩 신고 목록 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const getFundingReportDetailForAdmin = async (req, res) => {
  const reportId = Number(req.params.reportId);

  if (!Number.isInteger(reportId) || reportId <= 0) {
    return res.status(400).json({ status: 400, message: '펀딩 신고 ID가 올바르지 않습니다.' });
  }

  try {
    const reportTableName = await getAdminFundingReportTableName();
    const { rows } = await pool.query(
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
        fr.admin_memo,
        fr.reviewed_at,
        fr.reviewed_by,
        fr.created_at,
        fr.updated_at
      FROM ${reportTableName} fr
      LEFT JOIN funding_projects fp ON fp.funding_id = fr.funding_id
      LEFT JOIN users u ON u.user_id = fr.reporter_id
      WHERE fr.report_id = $1
      LIMIT 1
      `,
      [reportId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ status: 404, message: '펀딩 신고를 찾을 수 없습니다.' });
    }

    return res.status(200).json({
      status: 200,
      message: '펀딩 신고 상세 조회 성공',
      data: mapAdminFundingReport(rows[0]),
    });
  } catch (error) {
    console.error('[admin-funding-reports] detail failed', error);
    return res.status(500).json({
      status: 500,
      message: '펀딩 신고 상세 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const updateFundingReportStatusForAdmin = async (req, res) => {
  const reportId = Number(req.params.reportId);
  const nextStatus = normalizeAdminFundingReportStatus(req.body?.status);
  const adminMemo = typeof req.body?.adminMemo === 'string' ? req.body.adminMemo.trim() : null;

  if (!Number.isInteger(reportId) || reportId <= 0) {
    return res.status(400).json({ status: 400, message: '펀딩 신고 ID가 올바르지 않습니다.' });
  }

  if (!nextStatus) {
    return res.status(400).json({
      status: 400,
      message: ADMIN_FUNDING_REPORT_BAD_STATUS_MESSAGE,
    });
  }

  try {
    const reportTableName = await getAdminFundingReportTableName();
    const adminUserId = getAdminUserId(req);
    const { rows } = await pool.query(
      `
      UPDATE ${reportTableName}
      SET
        status = $2,
        admin_memo = $3,
        reviewed_at = CURRENT_TIMESTAMP,
        reviewed_by = $4,
        updated_at = CURRENT_TIMESTAMP
      WHERE report_id = $1
      RETURNING
        report_id,
        funding_id,
        reporter_id,
        reason,
        content,
        status,
        admin_memo,
        reviewed_at,
        reviewed_by,
        created_at,
        updated_at
      `,
      [reportId, nextStatus, adminMemo || null, adminUserId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ status: 404, message: '펀딩 신고를 찾을 수 없습니다.' });
    }

    console.log('[admin-funding-reports] status updated', {
      reportId,
      status: nextStatus,
      adminMemo: adminMemo || null,
      adminUserId: req.user?.userId || req.user?.id || null,
    });

    return res.status(200).json({
      status: 200,
      message: '펀딩 신고 상태가 수정되었습니다.',
      data: mapAdminFundingReport(rows[0]),
    });
  } catch (error) {
    console.error('[admin-funding-reports] status update failed', error);
    return res.status(500).json({
      status: 500,
      message: '펀딩 신고 상태 수정 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const getLawReviewQueueForAdmin = async (req, res) => {
  try {
    const data = await getLawReviewQueue(req.query || {});

    return res.status(200).json({
      status: 200,
      message: '?? ?? ? ?? ??',
      data,
    });
  } catch (error) {
    const status = error.statusCode || error.status || 500;
    console.error('[law-review] list failed', error);

    return res.status(status).json({
      status,
      message: error.message || '?? ?? ? ?? ? ?? ??? ??????.',
    });
  }
};

const getLawReviewDetailForAdmin = async (req, res) => {
  const reviewId = Number(req.params.reviewId);

  if (!Number.isInteger(reviewId) || reviewId <= 0) {
    return res.status(400).json({
      status: 400,
      message: '?? ?? ID? ???? ????.',
    });
  }

  try {
    const data = await getLawReviewDetail(reviewId);

    if (!data) {
      return res.status(404).json({
        status: 404,
        message: '?? ?? ??? ?? ? ????.',
      });
    }

    return res.status(200).json({
      status: 200,
      message: '?? ?? ?? ?? ??',
      data,
    });
  } catch (error) {
    console.error('[law-review] detail failed', error);

    return res.status(500).json({
      status: 500,
      message: '?? ?? ?? ?? ? ?? ??? ??????.',
    });
  }
};

const updateLawReviewStatusForAdmin = async (req, res) => {
  const reviewId = Number(req.params.reviewId);
  const status = req.body?.status;
  const adminMemo = typeof req.body?.adminMemo === 'string' ? req.body.adminMemo.trim() : null;

  if (!Number.isInteger(reviewId) || reviewId <= 0) {
    return res.status(400).json({
      status: 400,
      message: '?? ?? ID? ???? ????.',
    });
  }

  try {
    const data = await updateLawReviewStatus({
      reviewId,
      status,
      adminMemo,
      reviewedBy: getAdminUserId(req),
    });

    if (!data) {
      return res.status(404).json({
        status: 404,
        message: '?? ?? ??? ?? ? ????.',
      });
    }

    return res.status(200).json({
      status: 200,
      message: '?? ?? ??? ???????.',
      data,
    });
  } catch (error) {
    const responseStatus = error.statusCode || error.status || 500;
    console.error('[law-review] status update failed', error);

    return res.status(responseStatus).json({
      status: responseStatus,
      message: error.message || '?? ?? ?? ?? ? ?? ??? ??????.',
    });
  }
};

const settleExpiredFundingsManually = async (req, res) => {
  try {
    const settlementResult = await settleExpiredFundings();

    console.log('[funding-settlement] manual settlement completed', {
      successCount: settlementResult.successCount,
      failedCount: settlementResult.failedCount,
      processedCount: settlementResult.processedFundings.length,
      adminUserId: req.user?.userId || req.user?.id || null,
    });

    return res.status(200).json({
      status: 200,
      successCount: settlementResult.successCount,
      failedCount: settlementResult.failedCount,
      processedFundings: settlementResult.processedFundings,
      data: settlementResult,
      message: '마감된 펀딩 정산이 완료되었습니다.',
    });
  } catch (error) {
    console.error('[funding-settlement] manual settlement failed', error);

    return res.status(500).json({
      status: 500,
      message: '마감된 펀딩 정산 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const completeFundingSettlement = async (req, res) => {
  const { fundingId } = req.params;
  const {
    settlementId = null,
    settlementAmount = null,
    settledAt = null,
    payoutStatus = 'COMPLETED',
    linkUrl = null,
  } = req.body || {};

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(400).json({
      status: 400,
      message: '펀딩 ID가 올바르지 않습니다.',
    });
  }

  try {
    const fundingResult = await pool.query(
      `
      SELECT funding_id, status
      FROM funding_projects
      WHERE funding_id = $1
      LIMIT 1
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

    if (!['SUCCESS', 'SUCCESSFUL', 'FUNDING_SUCCESS'].includes(String(funding.status || '').toUpperCase())) {
      return res.status(400).json({
        status: 400,
        message: '성공 확정된 펀딩만 정산 완료 처리할 수 있습니다.',
      });
    }

    const notification = await createSettlementCompletedNotification(Number(fundingId), {
      settlementId,
      settlementAmount,
      settledAt,
      payoutStatus,
      linkUrl,
    });

    return res.status(200).json({
      status: 200,
      notification,
      message: notification
        ? '정산 완료 알림이 생성되었습니다.'
        : '이미 생성된 정산 완료 알림입니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '정산 완료 알림 생성 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

module.exports = {
  getSubmittedFundingDrafts,
  getFundingDraftReviewDetail,
  approveFundingDraft,
  rejectFundingDraft,
  cancelFundingProject,
  settleExpiredFundingsManually,
  completeFundingSettlement,
  getFundingReportsForAdmin,
  getFundingReportDetailForAdmin,
  updateFundingReportStatusForAdmin,
  getLawReviewQueueForAdmin,
  getLawReviewDetailForAdmin,
  updateLawReviewStatusForAdmin,
};
