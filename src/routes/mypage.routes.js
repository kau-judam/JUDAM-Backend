const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');

const {
  getMyProfileController,
  getMyPageSummaryController,
  checkNicknameController,
  updateNicknameController,
  updatePhoneNumberController,
} = require('../controllers/mypage.controller');

const router = express.Router();

router.get('/summary', authMiddleware, getMyPageSummaryController);
router.get('/profile', authMiddleware, getMyProfileController);
router.get('/profile/nickname/check', authMiddleware, checkNicknameController);
router.patch('/profile/nickname', authMiddleware, updateNicknameController);
router.patch('/profile/phone', authMiddleware, updatePhoneNumberController);

module.exports = router;
