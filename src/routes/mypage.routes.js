const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middlewares/authMiddleware');

const {
  getMyProfileController,
  getMyPageSummaryController,
  getMySulbtiController,
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
  updateMyArchiveController,
  deleteMyArchiveController,
  getArchiveTagsController,
} = require('../controllers/mypage.controller');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/summary', authMiddleware, getMyPageSummaryController);
router.get('/sulbti', authMiddleware, getMySulbtiController);
router.post('/sulbti', authMiddleware, saveMySulbtiController);
router.get('/archives/tags', authMiddleware, getArchiveTagsController);
router.get('/archives', authMiddleware, getMyArchivesController);
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
