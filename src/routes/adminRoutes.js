const express = require('express');
const router = express.Router();

const {
  getSubmittedFundingDrafts,
  approveFundingDraft,
  rejectFundingDraft,
  settleExpiredFundingProjects,
  completeFundingSettlement,
} = require('../controllers/admin.controller');

router.get('/fundings/drafts', getSubmittedFundingDrafts);
router.patch('/fundings/drafts/:draftId/approve', approveFundingDraft);
router.patch('/fundings/drafts/:draftId/reject', rejectFundingDraft);
router.post('/fundings/settle-expired', settleExpiredFundingProjects);
router.post('/fundings/:fundingId/settlement-completed', completeFundingSettlement);

module.exports = router;
