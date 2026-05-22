const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const optionalAuthMiddleware = require('../middlewares/optionalAuthMiddleware');
const {
  upload,
  postPost,
  getPosts,
  getPostDetail,
  putPost,
  deletePostHandler,
} = require('../controllers/postController');
const {
  getCommentList,
  postComment,
  putCommentHandler,
  deleteCommentHandler,
} = require('../controllers/postCommentController');

// 게시글 작성 — 로그인 필수, 이미지 파일 수신(multer, 최대 5개)
router.post('/', authMiddleware, upload.array('images'), postPost);

// 게시글 목록 조회 — 로그인 선택 (is_liked, is_mine 반영)
router.get('/', optionalAuthMiddleware, getPosts);

// 게시글 상세 조회 — 로그인 선택 (is_liked, is_mine 반영)
router.get('/:postId', optionalAuthMiddleware, getPostDetail);

// 게시글 수정 — 로그인 필수, 이미지 완전 교체 (multer, 최대 5개)
router.put('/:postId', authMiddleware, upload.array('images'), putPost);

// 게시글 삭제 — 로그인 필수, 작성자 본인만 가능
router.delete('/:postId', authMiddleware, deletePostHandler);

// 댓글 목록 조회 — 로그인 선택 (is_liked, is_mine 반영)
router.get('/:postId/comments', optionalAuthMiddleware, getCommentList);

// 댓글 작성 — 로그인 필수
router.post('/:postId/comments', authMiddleware, postComment);

// 댓글 수정 — 로그인 필수, 작성자 본인만
router.put('/:postId/comments/:commentId', authMiddleware, putCommentHandler);

// 댓글 삭제 — 로그인 필수, 작성자 본인만
router.delete('/:postId/comments/:commentId', authMiddleware, deleteCommentHandler);

module.exports = router;
