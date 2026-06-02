const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');

const {
  getSubmittedFundingDrafts,
  approveFundingDraft,
  rejectFundingDraft,
  cancelFundingProject,
  settleExpiredFundingsManually,
  completeFundingSettlement,
} = require('../controllers/admin.controller');

const requireAdmin = (req, res, next) => {
  const role = String(req.user?.role || req.user?.userRole || req.user?.type || '').toUpperCase();

  if (role !== 'ADMIN') {
    return res.status(403).json({
      status: 403,
      message: '관리자만 호출할 수 있습니다.',
    });
  }

  return next();
};

router.get('/fundings/drafts', getSubmittedFundingDrafts);
router.patch('/fundings/drafts/:draftId/approve', approveFundingDraft);
router.patch('/fundings/drafts/:draftId/reject', rejectFundingDraft);
router.patch(
  '/fundings/:fundingId/cancel',
  authMiddleware,
  requireAdmin,
  cancelFundingProject,
);
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
