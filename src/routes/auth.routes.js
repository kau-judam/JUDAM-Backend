const express = require('express');
const {
  kakaoLoginUrl,
  kakaoLogin,
  kakaoCallback,
  kakaoLoginByCode,
  refreshAccessToken,
  logout,
} = require('../controllers/auth.controller');

const router = express.Router();

router.get('/kakao/url', kakaoLoginUrl);
router.get('/kakao', kakaoLogin);
router.get('/kakao/callback', kakaoCallback);
router.post('/kakao/login', kakaoLoginByCode);
router.post('/refresh', refreshAccessToken);
router.post('/logout', logout);

module.exports = router;
