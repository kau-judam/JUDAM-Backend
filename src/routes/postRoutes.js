const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { upload, postPost } = require('../controllers/postController');

// 게시글 작성 — 로그인 필수, 이미지 파일 수신(multer, 최대 5개)
router.post('/', authMiddleware, upload.array('images'), postPost);

module.exports = router;
