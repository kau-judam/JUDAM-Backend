const express = require('express');
const router = express.Router();

const {
  saveAgreement,
  createFundingDraft, 
  updateFundingDraft
} = require('../controllers/funding.controller');

router.post('/agreements', saveAgreement);
router.post('/drafts', createFundingDraft);
router.patch('/drafts/:draftId', updateFundingDraft);

module.exports = router;