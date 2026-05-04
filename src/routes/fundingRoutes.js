const express = require('express');
const router = express.Router();

//서류업로드 관련
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

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
  uploadDocument,
  getFundingList,
  getFundingDetail,
  getFundingIntro,
  getBreweryLogs,
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
router.post('/drafts/:draftId/documents', upload.single('file'), uploadDocument);
router.get('/', getFundingList);
router.get('/:fundingId/intro', getFundingIntro);
router.get('/:fundingId/brewery-logs', getBreweryLogs);
router.get('/:fundingId', getFundingDetail);


module.exports = router;