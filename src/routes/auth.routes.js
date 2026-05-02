const express = require('express');
const { kakaoLogin, kakaoCallback } = require('../controllers/auth.controller');

const router = express.Router();

router.get('/kakao', kakaoLogin);
router.get('/kakao/callback', kakaoCallback);

module.exports = router;
