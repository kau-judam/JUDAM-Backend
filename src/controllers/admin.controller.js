const pool = require('../config/db');
const {
  registerFundingProjectToAiPool,
} = require('../services/funding.service');
const {
  createFundingCreatedNotification,
  createSettlementCompletedNotification,
} = require('../services/breweryDashboardNotification.service');
const { settleExpiredFundings } = require('../services/fundingSettlement.service');

// 관리자 제출 프로젝트 목록 조회
const getSubmittedFundingDrafts = async (req, res) => {
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
  ).trim();
  const optionName = baseName.endsWith('기본 후원')
    ? baseName
    : `${baseName} 기본 후원`;

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

    if (draft.status !== 'SUBMITTED') {
      return res.status(400).json({
        status: 400,
        message: '제출된 프로젝트만 승인할 수 있습니다.',
      });
    }

    const client = await pool.connect();
    let funding;

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

      await client.query(
        `
        UPDATE funding_drafts
        SET
          status = 'APPROVED',
          funding_id = $2,
          updated_at = CURRENT_TIMESTAMP
        WHERE draft_id = $1
        `,
        [Number(draftId), funding.funding_id]
      );

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
      draftId: Number(draftId),
      fundingId: funding.funding_id,
      title: funding.title,
      status: funding.status,
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
  const { rejectReason } = req.body;

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
          updated_at = CURRENT_TIMESTAMP
        WHERE draft_id = $2
        RETURNING draft_id, funding_id, status, reject_reason, updated_at
        `,
        [rejectReason.trim(), Number(draftId)]
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
          RETURNING funding_id, status, updated_at
          `,
          [Number(rejectedDraft.funding_id)]
        );

        rejectedFunding = fundingResult.rows[0] || null;
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return res.status(200).json({
      draftId: rejectedDraft.draft_id,
      fundingId: rejectedDraft.funding_id ? Number(rejectedDraft.funding_id) : null,
      status: rejectedDraft.status,
      projectStatus: rejectedFunding?.status || null,
      rejectReason: rejectedDraft.reject_reason,
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

    const updateResult = await pool.query(
      `
      UPDATE funding_projects
      SET
        status = 'CANCELED',
        updated_at = CURRENT_TIMESTAMP
      WHERE funding_id = $1
      RETURNING
        funding_id,
        title,
        status,
        current_amount,
        goal_amount,
        updated_at
      `,
      [Number(fundingId)]
    );

    const canceledFunding = updateResult.rows[0];

    console.log('[funding-cancel] funding canceled by admin', {
      fundingId: Number(canceledFunding.funding_id),
      previousStatus: currentStatus,
      newStatus: canceledFunding.status,
      cancelReason: cancelReason || null,
      adminUserId: req.user?.userId || req.user?.id || null,
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
  const pageNumber = Number(page);
  const sizeNumber = Number(size);

  if (status && !ADMIN_FUNDING_REPORT_STATUSES.includes(normalizedStatus)) {
    return res.status(400).json({
      status: 400,
      message: '?? ??? PENDING, REVIEWED, RESOLVED, REJECTED ? ???? ???.',
    });
  }

  if (!Number.isInteger(pageNumber) || pageNumber < 0 || !Number.isInteger(sizeNumber) || sizeNumber <= 0) {
    return res.status(400).json({
      status: 400,
      message: '??? ?? ?? ???? ????.',
    });
  }

  try {
    const reportTableName = await getAdminFundingReportTableName();
    const values = [];
    const conditions = [];

    if (normalizedStatus) {
      values.push(normalizedStatus);
      conditions.push(`fr.status = ${values.length}`);
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
        fr.created_at,
        fr.updated_at
      FROM ${reportTableName} fr
      LEFT JOIN funding_projects fp ON fp.funding_id = fr.funding_id
      LEFT JOIN users u ON u.user_id = fr.reporter_id
      ${whereClause}
      ORDER BY fr.created_at DESC, fr.report_id DESC
      LIMIT ${listValues.length - 1}
      OFFSET ${listValues.length}
      `,
      listValues,
    );

    const totalElements = Number(countResult.rows[0]?.total_count || 0);

    return res.status(200).json({
      status: 200,
      message: '?? ?? ?? ?? ??',
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
      message: '?? ?? ?? ?? ? ?? ??? ??????.',
      error: error.message,
    });
  }
};

const getFundingReportDetailForAdmin = async (req, res) => {
  const reportId = Number(req.params.reportId);

  if (!Number.isInteger(reportId) || reportId <= 0) {
    return res.status(400).json({ status: 400, message: '??? ?? ID? ????.' });
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
      return res.status(404).json({ status: 404, message: '??? ?? ? ????.' });
    }

    return res.status(200).json({
      status: 200,
      message: '?? ?? ?? ?? ??',
      data: mapAdminFundingReport(rows[0]),
    });
  } catch (error) {
    console.error('[admin-funding-reports] detail failed', error);
    return res.status(500).json({
      status: 500,
      message: '?? ?? ?? ?? ? ?? ??? ??????.',
      error: error.message,
    });
  }
};

const updateFundingReportStatusForAdmin = async (req, res) => {
  const reportId = Number(req.params.reportId);
  const nextStatus = normalizeAdminFundingReportStatus(req.body?.status);
  const adminMemo = typeof req.body?.adminMemo === 'string' ? req.body.adminMemo.trim() : null;

  if (!Number.isInteger(reportId) || reportId <= 0) {
    return res.status(400).json({ status: 400, message: '??? ?? ID? ????.' });
  }

  if (!ADMIN_FUNDING_REPORT_STATUSES.includes(nextStatus)) {
    return res.status(400).json({
      status: 400,
      message: '?? ??? PENDING, REVIEWED, RESOLVED, REJECTED ? ???? ???.',
    });
  }

  try {
    const reportTableName = await getAdminFundingReportTableName();
    const { rows } = await pool.query(
      `
      UPDATE ${reportTableName}
      SET
        status = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE report_id = $1
      RETURNING report_id, funding_id, reporter_id, reason, content, status, created_at, updated_at
      `,
      [reportId, nextStatus],
    );

    if (rows.length === 0) {
      return res.status(404).json({ status: 404, message: '??? ?? ? ????.' });
    }

    console.log('[admin-funding-reports] status updated', {
      reportId,
      status: nextStatus,
      adminMemo: adminMemo || null,
      adminUserId: req.user?.userId || req.user?.id || null,
    });

    return res.status(200).json({
      status: 200,
      message: '?? ?? ?? ??? ???????.',
      data: mapAdminFundingReport(rows[0]),
    });
  } catch (error) {
    console.error('[admin-funding-reports] status update failed', error);
    return res.status(500).json({
      status: 500,
      message: '?? ?? ?? ?? ?? ? ?? ??? ??????.',
      error: error.message,
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
  approveFundingDraft,
  rejectFundingDraft,
  cancelFundingProject,
  settleExpiredFundingsManually,
  completeFundingSettlement,
};
