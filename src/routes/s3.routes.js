const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { getPresignedUrl } = require('../controllers/s3.controller');

// presigned URL 발급 — 로그인 필수 (본인 uploads 경로에 업로드)
router.get('/presigned-url', authMiddleware, getPresignedUrl);

module.exports = router;
