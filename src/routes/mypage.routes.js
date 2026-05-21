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
  updateProfileImageController,
} = require('../controllers/mypage.controller');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/summary', authMiddleware, getMyPageSummaryController);
router.get('/sulbti', authMiddleware, getMySulbtiController);
router.post('/sulbti', authMiddleware, saveMySulbtiController);
router.get('/profile', authMiddleware, getMyProfileController);
router.get('/profile/nickname/check', authMiddleware, checkNicknameController);
router.patch('/profile/nickname', authMiddleware, updateNicknameController);
router.patch('/profile/phone', authMiddleware, updatePhoneNumberController);
router.patch('/profile/image', authMiddleware, upload.single('image'), updateProfileImageController);

module.exports = router;
