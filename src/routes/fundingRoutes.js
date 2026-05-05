const express = require('express');
const router = express.Router();

const {
  saveAgreement,
  createFundingDraft, 
  updateFundingDraft,
  saveBasicInfo,
  saveSchedule,
  saveLegalInfo,
} = require('../controllers/funding.controller');

router.post('/agreements', saveAgreement);
router.post('/drafts', createFundingDraft);
router.patch('/drafts/:draftId', updateFundingDraft);
router.patch('/drafts/:draftId/basic-info', saveBasicInfo);
router.patch('/drafts/:draftId/schedule', saveSchedule);
router.patch('/drafts/:draftId/legal-info', saveLegalInfo);

module.exports = router;