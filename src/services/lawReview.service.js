const pool = require('../config/db');

const LAW_REVIEW_TARGET_TYPES = new Set(['RECIPE']);
const LAW_REVIEW_STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED']);

const normalizeStatus = (status) => String(status || '').trim().toUpperCase();

const toPositiveInteger = (value, fallback) => {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : fallback;
};

const toNonNegativeInteger = (value, fallback) => {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= 0 ? numberValue : fallback;
};

const mapLawReview = (row = {}) => ({
  reviewId: Number(row.review_id),
  targetType: row.target_type,
  targetId: row.target_id === null || row.target_id === undefined ? null : Number(row.target_id),
  submitterUserId: row.submitter_user_id === null || row.submitter_user_id === undefined
    ? null
    : Number(row.submitter_user_id),
  submitterNickname: row.submitter_nickname || null,
  requestPayload: row.request_payload || {},
  verdict: row.ai_verdict,
  violation: Boolean(row.ai_violation),
  details: row.ai_details || [],
  recommendation: row.ai_recommendation || null,
  status: row.status,
  adminMemo: row.admin_memo || null,
  reviewedAt: row.reviewed_at || null,
  reviewedBy: row.reviewed_by === null || row.reviewed_by === undefined ? null : Number(row.reviewed_by),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const createLawReviewQueueItem = async ({
  targetType = 'RECIPE',
  targetId = null,
  submitterUserId = null,
  requestPayload = {},
  aiResult = {},
}) => {
  const normalizedTargetType = String(targetType || '').trim().toUpperCase();

  if (!LAW_REVIEW_TARGET_TYPES.has(normalizedTargetType)) {
    const error = new Error('지원하지 않는 법률 검토 대상입니다.');
    error.statusCode = 400;
    throw error;
  }

  const details = Array.isArray(aiResult.details) ? aiResult.details : [];
  const { rows } = await pool.query(
    `
    INSERT INTO law_review_queue (
      target_type,
      target_id,
      submitter_user_id,
      request_payload,
      ai_verdict,
      ai_violation,
      ai_details,
      ai_recommendation,
      status
    )
    VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8, 'PENDING')
    RETURNING *
    `,
    [
      normalizedTargetType,
      targetId,
      submitterUserId,
      JSON.stringify(requestPayload || {}),
      String(aiResult.verdict || 'review').toLowerCase(),
      Boolean(aiResult.violation),
      JSON.stringify(details),
      aiResult.recommendation || null,
    ],
  );

  return mapLawReview(rows[0]);
};

const getLawReviewQueue = async ({ status, page = 0, size = 20 } = {}) => {
  const normalizedStatus = normalizeStatus(status);
  const pageNumber = toNonNegativeInteger(Number(page), 0);
  const sizeNumber = Math.min(toPositiveInteger(Number(size), 20), 100);
  const values = [];
  const conditions = [];

  if (normalizedStatus) {
    if (!LAW_REVIEW_STATUSES.has(normalizedStatus)) {
      const error = new Error('status는 PENDING, APPROVED, REJECTED 중 하나여야 합니다.');
      error.statusCode = 400;
      throw error;
    }

    values.push(normalizedStatus);
    conditions.push(`lrq.status = $${values.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total_count FROM law_review_queue lrq ${whereClause}`,
    values,
  );
  const listValues = [...values, sizeNumber, pageNumber * sizeNumber];
  const { rows } = await pool.query(
    `
    SELECT
      lrq.*,
      u.nickname AS submitter_nickname
    FROM law_review_queue lrq
    LEFT JOIN users u ON u.user_id = lrq.submitter_user_id
    ${whereClause}
    ORDER BY lrq.created_at DESC, lrq.review_id DESC
    LIMIT $${listValues.length - 1}
    OFFSET $${listValues.length}
    `,
    listValues,
  );
  const totalElements = Number(countResult.rows[0]?.total_count || 0);

  return {
    content: rows.map(mapLawReview),
    page: pageNumber,
    size: sizeNumber,
    totalElements,
    totalPages: Math.ceil(totalElements / sizeNumber),
  };
};

const getLawReviewDetail = async (reviewId) => {
  const { rows } = await pool.query(
    `
    SELECT
      lrq.*,
      u.nickname AS submitter_nickname
    FROM law_review_queue lrq
    LEFT JOIN users u ON u.user_id = lrq.submitter_user_id
    WHERE lrq.review_id = $1
    LIMIT 1
    `,
    [reviewId],
  );

  return rows[0] ? mapLawReview(rows[0]) : null;
};

const updateLawReviewStatus = async ({
  reviewId,
  status,
  adminMemo = null,
  reviewedBy = null,
}) => {
  const normalizedStatus = normalizeStatus(status);

  if (!LAW_REVIEW_STATUSES.has(normalizedStatus) || normalizedStatus === 'PENDING') {
    const error = new Error('status는 APPROVED 또는 REJECTED만 가능합니다.');
    error.statusCode = 400;
    throw error;
  }

  const { rows } = await pool.query(
    `
    UPDATE law_review_queue
    SET
      status = $2,
      admin_memo = $3,
      reviewed_at = CURRENT_TIMESTAMP,
      reviewed_by = $4,
      updated_at = CURRENT_TIMESTAMP
    WHERE review_id = $1
    RETURNING *
    `,
    [reviewId, normalizedStatus, adminMemo || null, reviewedBy],
  );

  return rows[0] ? mapLawReview(rows[0]) : null;
};

module.exports = {
  LAW_REVIEW_STATUSES,
  createLawReviewQueueItem,
  getLawReviewQueue,
  getLawReviewDetail,
  updateLawReviewStatus,
};
