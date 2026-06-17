const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');
const {
  checkEmail,
  checkNickname,
  signup,
  login,
  updateMyRole,
  requestAuthPhoneVerificationController,
  confirmAuthPhoneVerificationController,
  requestPasswordReset,
  verifyPasswordReset,
  resetPassword,
  requestPasswordResetPhone,
  confirmPasswordResetPhone,
  completePasswordResetPhone,
  kakaoLoginUrl,
  kakaoLogin,
  kakaoCallback,
  kakaoLoginByCode,
  completeKakaoSignup,
  refreshAccessToken,
  logout,
} = require('../controllers/auth.controller');

const router = express.Router();

router.get('/email/check', checkEmail);
router.get('/nickname/check', checkNickname);
router.post('/signup', signup);
router.post('/login', login);
router.patch('/me/role', authMiddleware, updateMyRole);
router.post('/phone/verification', requestAuthPhoneVerificationController);
router.post('/phone/verification/confirm', confirmAuthPhoneVerificationController);
router.post('/password/reset/request', requestPasswordReset);
router.post('/password/reset/verify', verifyPasswordReset);
router.post('/password/reset/confirm', resetPassword);
router.patch('/password/reset', resetPassword);
router.post('/password-reset/phone/request', requestPasswordResetPhone);
router.post('/password-reset/phone/confirm', confirmPasswordResetPhone);
router.post('/password-reset/phone/complete', completePasswordResetPhone);
router.get('/kakao/url', kakaoLoginUrl);
router.get('/kakao', kakaoLogin);
router.get('/kakao/callback', kakaoCallback);
router.post('/kakao/login', kakaoLoginByCode);
router.post('/kakao/signup/complete', completeKakaoSignup);
router.post('/refresh', refreshAccessToken);
router.post('/logout', logout);

module.exports = router;
