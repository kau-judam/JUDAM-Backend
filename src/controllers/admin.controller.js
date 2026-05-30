const pool = require('../config/db');
const {
  registerFundingProjectToAiPool,
  settleExpiredFundings,
} = require('../services/funding.service');
const {
  createFundingCreatedNotification,
} = require('../services/breweryDashboardNotification.service');

// 관리자 제출 프로젝트 목록 조회
const getSubmittedFundingDrafts = async (req, res) => {
  const { status = 'SUBMITTED' } = req.query;

  const allowedStatuses = [
    'SUBMITTED',
    'APPROVED',
    'REJECTED',
  ];

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 상태값입니다.',
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
        summary,
        thumbnail_url,
        progress_rate,
        status,
        submitted_at,
        created_at,
        updated_at
      FROM funding_drafts
      WHERE status = $1
      ORDER BY submitted_at DESC NULLS LAST
      `,
      [status]
    );

    return res.status(200).json({
      drafts: result.rows,
      message: '제출 프로젝트 목록 조회 성공',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '제출 프로젝트 목록 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
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
            status = 'ONGOING',
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
            $1, $2, $3, $4, $5, 0, $6, $7, 'ONGOING', $8, $9, $10, $11,
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

    return res.status(500).json({
      status: 500,
      message: '프로젝트 승인 중 서버 오류가 발생했습니다.',
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
      SELECT draft_id, status
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
        message: '제출된 프로젝트만 반려할 수 있습니다.',
      });
    }

    const result = await pool.query(
      `
      UPDATE funding_drafts
      SET
        status = 'REJECTED',
        reject_reason = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE draft_id = $2
      RETURNING draft_id, status, reject_reason, updated_at
      `,
      [rejectReason.trim(), Number(draftId)]
    );

    const rejectedDraft = result.rows[0];

    return res.status(200).json({
      draftId: rejectedDraft.draft_id,
      status: rejectedDraft.status,
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
      message: '마감 펀딩 정산 완료',
      data: settlementResult,
    });
  } catch (error) {
    console.error('[funding-settlement] manual settlement failed', error);

    return res.status(500).json({
      status: 500,
      message: '마감 펀딩 정산 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

module.exports = {
  getSubmittedFundingDrafts,
  approveFundingDraft,
  rejectFundingDraft,
  settleExpiredFundingsManually,
};
