const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const optionalAuthMiddleware = require('../middlewares/optionalAuthMiddleware');
const { upload, postPost, getPosts } = require('../controllers/postController');

// 게시글 작성 — 로그인 필수, 이미지 파일 수신(multer, 최대 5개)
router.post('/', authMiddleware, upload.array('images'), postPost);

// 게시글 목록 조회 — 로그인 선택 (is_liked, is_mine 반영)
router.get('/', optionalAuthMiddleware, getPosts);

module.exports = router;
