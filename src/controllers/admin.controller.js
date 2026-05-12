const pool = require('../config/db');

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

    const recipeId = 3; // TODO: 추후 draft 기반 recipe 생성 로직으로 교체

    const fundingResult = await pool.query(
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
        price_per_bottle,
        shipping_fee
      )
      VALUES ($1, $2, $3, $4, $5, 0, $6, $7, 'ONGOING', $8, 3000)
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
        draft.summary,
        Number(draft.target_amount || 0),
        draft.funding_start_date,
        draft.funding_end_date,
        Number(draft.price_per_bottle || 0),
      ]
    );

    await pool.query(
      `
      UPDATE funding_drafts
      SET
        status = 'APPROVED',
        updated_at = CURRENT_TIMESTAMP
      WHERE draft_id = $1
      `,
      [Number(draftId)]
    );

    const funding = fundingResult.rows[0];

    return res.status(200).json({
      draftId: Number(draftId),
      fundingId: funding.funding_id,
      title: funding.title,
      status: funding.status,
      createdAt: funding.created_at,
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

module.exports = {
  getSubmittedFundingDrafts,
  approveFundingDraft,
  rejectFundingDraft,
};