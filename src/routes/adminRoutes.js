const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');

const {
  getSubmittedFundingDrafts,
  getFundingDraftReviewDetail,
  approveFundingDraft,
  rejectFundingDraft,
  cancelFundingProject,
  getFundingReportsForAdmin,
  getFundingReportDetailForAdmin,
  updateFundingReportStatusForAdmin,
  getLawReviewQueueForAdmin,
  getLawReviewDetailForAdmin,
  updateLawReviewStatusForAdmin,
  settleExpiredFundingsManually,
  completeFundingSettlement,
} = require('../controllers/admin.controller');

const requireAdmin = (req, res, next) => {
  const role = String(req.user?.role || req.user?.userRole || req.user?.type || '').toUpperCase();

  if (role !== 'ADMIN') {
    return res.status(403).json({
      status: 403,
      message: '???? ??? ? ????.',
    });
  }

  return next();
};

router.get('/fundings/drafts', authMiddleware, requireAdmin, getSubmittedFundingDrafts);
router.get('/fundings/drafts/:draftId', authMiddleware, requireAdmin, getFundingDraftReviewDetail);
router.patch('/fundings/drafts/:draftId/approve', authMiddleware, requireAdmin, approveFundingDraft);
router.patch('/fundings/drafts/:draftId/reject', authMiddleware, requireAdmin, rejectFundingDraft);
router.get('/fundings/reviews', authMiddleware, requireAdmin, getSubmittedFundingDrafts);
router.get('/fundings/reviews/:draftId', authMiddleware, requireAdmin, getFundingDraftReviewDetail);
router.patch('/fundings/reviews/:draftId/approve', authMiddleware, requireAdmin, approveFundingDraft);
router.patch('/fundings/reviews/:draftId/reject', authMiddleware, requireAdmin, rejectFundingDraft);
router.patch(
  '/fundings/:fundingId/cancel',
  authMiddleware,
  requireAdmin,
  cancelFundingProject,
);
router.get('/funding-reports', authMiddleware, requireAdmin, getFundingReportsForAdmin);
router.get('/funding-reports/:reportId', authMiddleware, requireAdmin, getFundingReportDetailForAdmin);
router.patch('/funding-reports/:reportId/status', authMiddleware, requireAdmin, updateFundingReportStatusForAdmin);
router.get('/law-reviews', authMiddleware, requireAdmin, getLawReviewQueueForAdmin);
router.get('/law-reviews/:reviewId', authMiddleware, requireAdmin, getLawReviewDetailForAdmin);
router.patch('/law-reviews/:reviewId/status', authMiddleware, requireAdmin, updateLawReviewStatusForAdmin);
router.post(
  '/fundings/settle-expired',
  authMiddleware,
  requireAdmin,
  settleExpiredFundingsManually,
);
router.post(
  '/fundings/:fundingId/settlement-completed',
  authMiddleware,
  requireAdmin,
  completeFundingSettlement,
);

module.exports = router;
