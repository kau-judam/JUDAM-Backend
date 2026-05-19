const express = require('express');
const router = express.Router();

// 서류/이미지 업로드 관련
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
  loadBreweryInfo,
  uploadFundingDraftFile,
  verifyPhoneForFundingDraft,
  verifyAccountForFundingDraft,
  saveNotices,
  submitFundingDraft,
  uploadDocument,
  getFundingDraft,
  getFundingDraftList,
  deleteFundingDraft,
  getFundingDraftPreview,
  updateFundingProject,
  getFundingList,
  getFundingDetail,
  getFundingIntro,
  getBreweryLogs,
  getFundingQuestions,
  createFundingQuestion,
  createFundingReply,
  getFundingReviews,
  getSupportOptions,
  createFundingOrder,
  createFundingInquiry,
  createBreweryLog,
  updateBreweryLog,
  deleteBreweryLog,
  getFundingShareLink,
  createFundingReport,
  getFundingReports,
  createFundingReview,
  likeFundingProject,
  unlikeFundingProject,
} = require('../controllers/funding.controller');

router.post('/agreements', saveAgreement);

router.post('/drafts', createFundingDraft);
router.get('/drafts', getFundingDraftList);
router.get('/drafts/:draftId', getFundingDraft);
router.patch('/drafts/:draftId', updateFundingDraft);
router.delete('/drafts/:draftId', deleteFundingDraft);

router.patch('/drafts/:draftId/basic-info', saveBasicInfo);
router.patch('/drafts/:draftId/schedule', saveSchedule);
router.patch('/drafts/:draftId/legal-info', saveLegalInfo);
router.patch('/drafts/:draftId/taste-profile', saveTasteProfile);
router.patch('/drafts/:draftId/plan', savePlan);
router.patch('/drafts/:draftId/brewery-info', saveBreweryInfo);
router.patch('/drafts/:draftId/notices', saveNotices);

router.get('/drafts/:draftId/brewery-info/load', loadBreweryInfo);
router.post('/drafts/:draftId/files', upload.single('file'), uploadFundingDraftFile);
router.post('/drafts/:draftId/phone-verification', verifyPhoneForFundingDraft);
router.post('/drafts/:draftId/account-verification', verifyAccountForFundingDraft);

router.post('/drafts/:draftId/documents', upload.single('file'), uploadDocument);
router.post('/drafts/:draftId/submit', submitFundingDraft);
router.get('/drafts/:draftId/preview', getFundingDraftPreview);

router.get('/', getFundingList);

// 펀딩 신고 목록 조회
router.get('/reports', getFundingReports);

router.get('/:fundingId/intro', getFundingIntro);
router.get('/:fundingId/brewery-logs', getBreweryLogs);
router.get('/:fundingId/share-link', getFundingShareLink);

// 양조일지 등록/수정/삭제
router.post('/:fundingId/brewery-logs', upload.array('images', 5), createBreweryLog);
router.patch('/:fundingId/brewery-logs/:breweryLogId', upload.array('images', 5), updateBreweryLog);
router.delete('/:fundingId/brewery-logs/:breweryLogId', deleteBreweryLog);

// 펀딩 신고 등록
router.post('/:fundingId/reports', createFundingReport);

router.get('/:fundingId/questions', getFundingQuestions);
router.post('/:fundingId/questions', createFundingQuestion);
router.post('/:fundingId/questions/:questionId/replies', createFundingReply);

router.get('/:fundingId/reviews', getFundingReviews);
router.post('/:fundingId/reviews', upload.array('images', 5), createFundingReview);

router.get('/:fundingId/support-options', getSupportOptions);
router.post('/:fundingId/orders', createFundingOrder);
router.post('/:fundingId/inquiries', createFundingInquiry);

// 펀딩 찜 등록/해제
router.post('/:fundingId/likes', likeFundingProject);
router.delete('/:fundingId/likes', unlikeFundingProject);

router.patch('/:fundingId', updateFundingProject);

router.get('/:fundingId', getFundingDetail); // 모든 상세/기타 라우트들은 이거 위에 있어야 함

module.exports = router;