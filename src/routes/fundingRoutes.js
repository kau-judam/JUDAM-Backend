const express = require('express');
const router = express.Router();
const optionalAuthMiddleware = require('../middlewares/optionalAuthMiddleware');

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
  requestBankAccountVerification,
  confirmBankAccountVerification,
  saveNotices,
  submitFundingDraft,
  uploadDocument,
  getFundingDraft,
  getFundingDraftByFundingId,
  getFundingDraftList,
  deleteFundingDraft,
  getFundingDraftPreview,
  updateFundingProject,
  getFundingList,
  getFundingStats,
  getFundingDetail,
  getFundingIntro,
  getBreweryLogs,
  getFundingQuestions,
  createFundingQuestion,
  createFundingReply,
  likeFundingQuestion,
  unlikeFundingQuestion,
  likeFundingQuestionReply,
  unlikeFundingQuestionReply,
  getFundingReviews,
  getFundingReviewDetail,
  likeFundingReview,
  unlikeFundingReview,
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
  updateFundingReview,
  deleteFundingReview,
  getFundingReviewComments,
  createFundingReviewComment,
  likeFundingReviewComment,
  unlikeFundingReviewComment,
  likeFundingProject,
  unlikeFundingProject,
  likeBreweryLog,
  unlikeBreweryLog,
  createBreweryLogComment,
  createBreweryLogReply,
  getBreweryLogComments,
  likeBreweryLogComment,
  unlikeBreweryLogComment,
} = require('../controllers/funding.controller');

router.use(optionalAuthMiddleware);

router.post('/agreements', saveAgreement);

router.post('/drafts', createFundingDraft);
router.get('/drafts', getFundingDraftList);
router.get('/drafts/by-funding/:fundingId', getFundingDraftByFundingId);
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
router.post('/bank-account/verification', requestBankAccountVerification);
router.post('/bank-account/verification/confirm', confirmBankAccountVerification);

router.post('/drafts/:draftId/documents', upload.single('file'), uploadDocument);
router.post('/drafts/:draftId/submit', submitFundingDraft);
router.get('/drafts/:draftId/preview', getFundingDraftPreview);

router.get('/', getFundingList);

// 펀딩 신고 목록 조회
router.get('/reports', getFundingReports);
router.get('/stats', getFundingStats);

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
router.post('/:fundingId/questions/:questionId/likes', likeFundingQuestion);
router.delete('/:fundingId/questions/:questionId/likes', unlikeFundingQuestion);
router.post('/:fundingId/questions/:questionId/replies/:replyId/likes', likeFundingQuestionReply);
router.delete('/:fundingId/questions/:questionId/replies/:replyId/likes', unlikeFundingQuestionReply);

router.get('/:fundingId/reviews', getFundingReviews);
router.get('/:fundingId/reviews/:reviewId', getFundingReviewDetail);
router.post('/:fundingId/reviews', upload.array('images', 5), createFundingReview);
router.patch('/:fundingId/reviews/:reviewId', upload.array('images', 5), updateFundingReview);
router.delete('/:fundingId/reviews/:reviewId', deleteFundingReview);
router.post('/:fundingId/reviews/:reviewId/likes', likeFundingReview);
router.delete('/:fundingId/reviews/:reviewId/likes', unlikeFundingReview);
router.get('/:fundingId/reviews/:reviewId/comments', getFundingReviewComments);
router.post('/:fundingId/reviews/:reviewId/comments', createFundingReviewComment);
router.post('/:fundingId/reviews/:reviewId/comments/:commentId/likes', likeFundingReviewComment);
router.delete('/:fundingId/reviews/:reviewId/comments/:commentId/likes', unlikeFundingReviewComment);

router.get('/:fundingId/support-options', getSupportOptions);
router.post('/:fundingId/orders', createFundingOrder);
router.post('/:fundingId/inquiries', createFundingInquiry);

// 펀딩 찜 등록/해제
router.post('/:fundingId/likes', likeFundingProject);
router.delete('/:fundingId/likes', unlikeFundingProject);

router.patch('/:fundingId', updateFundingProject);

// 양조일지 좋아요 등록
router.post('/:fundingId/brewery-logs/:breweryLogId/likes', likeBreweryLog);
// 양조일지 좋아요 취소
router.delete('/:fundingId/brewery-logs/:breweryLogId/likes', unlikeBreweryLog);
// 양조일지 댓글 등록
router.post('/:fundingId/brewery-logs/:breweryLogId/comments', createBreweryLogComment);
// 양조일지 답글 등록
router.post('/:fundingId/brewery-logs/:breweryLogId/comments/:commentId/replies', createBreweryLogReply);
// 양조일지 댓글 목록 조회
router.get('/:fundingId/brewery-logs/:breweryLogId/comments', getBreweryLogComments);
//양조일지 댓글/답글 좋아요 등록,취소
router.post('/:fundingId/brewery-logs/:breweryLogId/comments/:commentId/likes', likeBreweryLogComment);

router.delete('/:fundingId/brewery-logs/:breweryLogId/comments/:commentId/likes',unlikeBreweryLogComment);
router.post('/:fundingId/brewery-logs/:breweryLogId/comments/:commentId/replies/:replyId/likes', likeBreweryLogComment);
router.delete('/:fundingId/brewery-logs/:breweryLogId/comments/:commentId/replies/:replyId/likes', unlikeBreweryLogComment);

router.get('/:fundingId', getFundingDetail); // 모든 상세/기타 라우트들은 이거 위에 있어야 함

module.exports = router;
