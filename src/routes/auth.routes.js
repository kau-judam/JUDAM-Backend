const express = require('express');
const {
  kakaoLogin,
  kakaoCallback,
  refreshAccessToken,
  logout,
} = require('../controllers/auth.controller');

const router = express.Router();

router.get('/kakao', kakaoLogin);
router.get('/kakao/callback', kakaoCallback);
router.post('/refresh', refreshAccessToken);
router.post('/logout', logout);

module.exports = router;
