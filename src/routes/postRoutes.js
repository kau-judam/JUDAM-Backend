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
  getReplyList,
  postReply,
} = require('../controllers/postCommentController');
const {
  postLike,
  deleteLike,
} = require('../controllers/postLikeController');
const {
  postCommentLike,
  deleteCommentLike,
} = require('../controllers/postCommentLikeController');

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

// 대댓글 목록 조회 — 로그인 선택 (is_liked, is_mine 반영)
router.get('/:postId/comments/:commentId/replies', optionalAuthMiddleware, getReplyList);

// 대댓글 작성 — 로그인 필수 (부모 댓글 존재 시 가능, 깊이 제한 없음)
router.post('/:postId/comments/:commentId/replies', authMiddleware, postReply);

// 댓글 좋아요 등록 — 로그인 필수 (UNIQUE 위반 시 400)
router.post('/:postId/comments/:commentId/likes', authMiddleware, postCommentLike);

// 댓글 좋아요 취소 — 로그인 필수 (내역 없으면 400)
router.delete('/:postId/comments/:commentId/likes', authMiddleware, deleteCommentLike);

// 좋아요 등록 — 로그인 필수 (UNIQUE 위반 시 400)
router.post('/:postId/likes', authMiddleware, postLike);

// 좋아요 취소 — 로그인 필수 (내역 없으면 400)
router.delete('/:postId/likes', authMiddleware, deleteLike);

module.exports = router;
