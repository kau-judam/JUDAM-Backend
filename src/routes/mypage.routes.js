const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middlewares/authMiddleware');

const {
  getMyProfileController,
  getMyPageSummaryController,
  getMyBadgesController,
  getMySulbtiController,
  getMySulbtiShareLinkController,
  saveMySulbtiController,
  checkNicknameController,
  updateNicknameController,
  updatePhoneNumberController,
  requestPhoneVerificationController,
  updateProfileImageController,
  changeMyPasswordController,
  getMyArchivesController,
  getMyArchiveDetailController,
  createMyArchiveController,
  createMyArchiveWithImagesController,
  updateMyArchiveController,
  updateMyArchiveWithImagesController,
  deleteMyArchiveController,
  getArchiveTagsController,
  uploadArchiveImagesController,
  deleteArchiveImageController,
  getParticipatedFundingsController,
  getMyFundingReviewController,
} = require('../controllers/mypage.controller');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/summary', authMiddleware, getMyPageSummaryController);
router.get('/badges', authMiddleware, getMyBadgesController);
router.get('/sulbti', authMiddleware, getMySulbtiController);
router.get('/sulbti/share-link', authMiddleware, getMySulbtiShareLinkController);
router.post('/sulbti', authMiddleware, saveMySulbtiController);
router.get('/archives/tags', authMiddleware, getArchiveTagsController);
router.get('/archives', authMiddleware, getMyArchivesController);
router.post('/archives/with-images', authMiddleware, upload.array('images', 3), createMyArchiveWithImagesController);
router.patch('/archives/:archiveId/with-images', authMiddleware, upload.array('images', 3), updateMyArchiveWithImagesController);
router.post('/archives/:archiveId/images', authMiddleware, upload.array('images', 3), uploadArchiveImagesController);
router.delete('/archives/:archiveId/images/:imageId', authMiddleware, deleteArchiveImageController);
router.get('/fundings/participated', authMiddleware, getParticipatedFundingsController);
router.get('/fundings/:fundingId/review', authMiddleware, getMyFundingReviewController);
router.get('/archives/:archiveId', authMiddleware, getMyArchiveDetailController);
router.post('/archives', authMiddleware, createMyArchiveController);
router.patch('/archives/:archiveId', authMiddleware, updateMyArchiveController);
router.delete('/archives/:archiveId', authMiddleware, deleteMyArchiveController);
router.get('/profile', authMiddleware, getMyProfileController);
router.get('/profile/nickname/check', authMiddleware, checkNicknameController);
router.patch('/profile/nickname', authMiddleware, updateNicknameController);
router.post('/profile/phone/verification', authMiddleware, requestPhoneVerificationController);
router.patch('/profile/phone', authMiddleware, updatePhoneNumberController);
router.patch('/profile/image', authMiddleware, upload.single('image'), updateProfileImageController);
router.patch('/profile/password', authMiddleware, changeMyPasswordController);

module.exports = router;
