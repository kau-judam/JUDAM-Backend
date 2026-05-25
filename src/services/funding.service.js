const pool = require('../config/db');
const { registerFundingToAiPool } = require('./ai.service');

const AI_REGISTERABLE_FUNDING_STATUSES = new Set(['ACTIVE', 'ONGOING']);

const normalizeString = (value) => {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
};

const normalizeNumber = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
};

const getFirstValue = (source, keys) => {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
      return source[key];
    }
  }

  return undefined;
};

const normalizeTasteInputScore = (source, keys) => {
  const value = getFirstValue(source, keys);
  const numberValue = normalizeNumber(value);

  if (numberValue === undefined) {
    return undefined;
  }

  return numberValue;
};

const buildTasteInput = (source) => {
  const tasteInput = {
    sweetness: normalizeTasteInputScore(source, ['sweetness']),
    body: normalizeTasteInputScore(source, ['body']),
    carbonation: normalizeTasteInputScore(source, ['carbonation']),
    flavor: normalizeTasteInputScore(source, ['flavor', 'flavor_intensity']),
    alcohol: normalizeTasteInputScore(source, ['alcohol', 'alcohol_intensity']),
    acidity: normalizeTasteInputScore(source, ['acidity']),
    aroma_intensity: normalizeTasteInputScore(source, ['aroma_intensity']),
    finish: normalizeTasteInputScore(source, ['finish']),
  };

  const hasAllTasteInput = Object.values(tasteInput).every((value) => value !== undefined);
  return hasAllTasteInput ? tasteInput : null;
};

const getFundingAiRegistrationSource = async (fundingId) => {
  const { rows } = await pool.query(
    `
      SELECT
        fp.funding_id,
        fp.brewery_user_id,
        fp.title,
        fp.short_title,
        fp.description,
        fp.summary,
        fp.status,
        fp.alcohol_percentage,
        fd.main_ingredient,
        fd.introduction,
        fd.brewery_name AS draft_brewery_name,
        fd.business_name,
        fd.business_address,
        fd.sweetness,
        fd.acidity,
        fd.body,
        fd.carbonation,
        fd.alcohol_intensity,
        ba.brewery_name AS approved_brewery_name,
        u.nickname AS user_nickname
      FROM funding_projects fp
      LEFT JOIN funding_drafts fd ON fd.funding_id = fp.funding_id
      LEFT JOIN LATERAL (
        SELECT brewery_name
        FROM brewery_auth
        WHERE user_id = fp.brewery_user_id
          AND status = 'APPROVED'
        ORDER BY updated_at DESC NULLS LAST, created_at DESC
        LIMIT 1
      ) ba ON TRUE
      LEFT JOIN users u ON u.user_id = fp.brewery_user_id
      WHERE fp.funding_id = $1
      LIMIT 1
    `,
    [Number(fundingId)],
  );

  return rows[0] || null;
};

const buildAiFundingRegisterPayload = (source) => {
  const fundingId = source.funding_id;
  const breweryUserId = source.brewery_user_id;
  const name = normalizeString(
    source.title || source.short_title || `funding_${fundingId}`,
  );
  const brewery = normalizeString(
    source.draft_brewery_name
      || source.approved_brewery_name
      || source.business_name
      || source.user_nickname
      || `brewery_${breweryUserId}`,
  );
  const description = normalizeString(
    source.description || source.summary || source.introduction,
  );
  const abv = normalizeNumber(source.alcohol_percentage);
  const tasteInput = buildTasteInput(source);

  const payload = {
    funding_id: String(fundingId),
    name,
    brewery,
    brewery_user_id: String(breweryUserId),
    region: '',
    main_ingredient: normalizeString(source.main_ingredient),
    description,
  };

  if (abv !== undefined) {
    payload.abv = abv;
  }

  if (tasteInput) {
    payload.taste_input = tasteInput;
  }

  return payload;
};

const mapAiRecommendationResult = (aiResponse) => {
  if (aiResponse?.alreadyRegistered) {
    return {
      registered: true,
      alreadyRegistered: true,
    };
  }

  return {
    registered: true,
    source: aiResponse?.source || null,
    tasteVector: aiResponse?.taste_vector || aiResponse?.tasteVector || null,
  };
};

const isAiFundingRegistrationStatus = (status) => (
  AI_REGISTERABLE_FUNDING_STATUSES.has(normalizeString(status).toUpperCase())
);

const registerFundingProjectToAiPool = async (fundingId) => {
  try {
    const source = await getFundingAiRegistrationSource(fundingId);

    if (!source) {
      return {
        registered: false,
        message: 'AI 추천 풀 등록에 필요한 펀딩 정보를 찾을 수 없습니다.',
      };
    }

    if (!isAiFundingRegistrationStatus(source.status)) {
      return {
        registered: false,
        skipped: true,
        message: 'AI 추천 풀 등록 대상 상태가 아닙니다.',
      };
    }

    const aiResponse = await registerFundingToAiPool(
      buildAiFundingRegisterPayload(source),
    );

    return mapAiRecommendationResult(aiResponse);
  } catch (error) {
    console.warn('AI funding registration failed', {
      fundingId,
      statusCode: error.statusCode,
      message: error.message,
    });

    return {
      registered: false,
      message: 'AI 추천 풀 등록에 실패했습니다.',
    };
  }
};

module.exports = {
  isAiFundingRegistrationStatus,
  registerFundingProjectToAiPool,
};
