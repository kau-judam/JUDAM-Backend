const express = require('express');
const router = express.Router();

const {
  saveAgreement,
  createFundingDraft, 
  updateFundingDraft,
  saveBasicInfo,
  saveSchedule,
  saveLegalInfo,
  saveTasteProfile,
  savePlan,
  saveBreweryInfo,
  saveNotices,
} = require('../controllers/funding.controller');

router.post('/agreements', saveAgreement);
router.post('/drafts', createFundingDraft);
router.patch('/drafts/:draftId', updateFundingDraft);
router.patch('/drafts/:draftId/basic-info', saveBasicInfo);
router.patch('/drafts/:draftId/schedule', saveSchedule);
router.patch('/drafts/:draftId/legal-info', saveLegalInfo);
router.patch('/drafts/:draftId/taste-profile', saveTasteProfile);
router.patch('/drafts/:draftId/plan', savePlan);
router.patch('/drafts/:draftId/brewery-info', saveBreweryInfo);
router.patch('/drafts/:draftId/notices', saveNotices);

module.exports = router;