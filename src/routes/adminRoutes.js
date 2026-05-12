const express = require('express');
const router = express.Router();

const {
  getSubmittedFundingDrafts,
  approveFundingDraft,
  rejectFundingDraft,
} = require('../controllers/admin.controller');

router.get('/fundings/drafts', getSubmittedFundingDrafts);
router.patch('/fundings/drafts/:draftId/approve', approveFundingDraft);
router.patch('/fundings/drafts/:draftId/reject', rejectFundingDraft);

module.exports = router;