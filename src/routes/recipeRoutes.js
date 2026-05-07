const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const optionalAuthMiddleware = require('../middlewares/optionalAuthMiddleware');
const breweryMiddleware = require('../middlewares/breweryMiddleware');
const { upload, postRecipe, getRecipeList, getRecipeDetail, postInterest, deleteInterest, postBreweryRecipe, getBreweryRecipes } = require('../controllers/recipeController');
const { getCommentList, postComment, putComment, deleteCommentHandler, postCommentLike, deleteCommentLike, getReplyList, postReply } = require('../controllers/recipeCommentController');

// 레시피 작성 — 로그인 필수, 이미지 파일 수신(multer)
router.post('/', authMiddleware, upload.single('image'), postRecipe);

// 레시피 목록 조회 — 로그인 선택 (is_interested 반영)
router.get('/', optionalAuthMiddleware, getRecipeList);

// 양조장 레시피 등록 — BREWERY 권한 필수 (/:recipeId보다 먼저 정의해야 충돌 방지)
router.post('/brewery', authMiddleware, breweryMiddleware, postBreweryRecipe);

// 양조장 소비자 레시피 확인 — BREWERY 권한 필수
router.get('/brewery', authMiddleware, breweryMiddleware, getBreweryRecipes);

// 레시피 상세 조회 — 로그인 선택 (is_interested 반영)
router.get('/:recipeId', optionalAuthMiddleware, getRecipeDetail);

// 관심 등록 — 로그인 필수
router.post('/:recipeId/interests', authMiddleware, postInterest);

// 관심 해제 — 로그인 필수
router.delete('/:recipeId/interests', authMiddleware, deleteInterest);

// 댓글 목록 조회 — 로그인 선택 (is_liked, is_mine 반영)
router.get('/:recipeId/comments', optionalAuthMiddleware, getCommentList);

// 댓글 작성 — 로그인 필수
router.post('/:recipeId/comments', authMiddleware, postComment);

// 댓글 수정 — 로그인 필수, 작성자 본인만
router.put('/:recipeId/comments/:commentId', authMiddleware, putComment);

// 댓글 삭제 — 로그인 필수, 작성자 본인만
router.delete('/:recipeId/comments/:commentId', authMiddleware, deleteCommentHandler);

// 댓글 좋아요 등록 — 로그인 필수
router.post('/:recipeId/comments/:commentId/likes', authMiddleware, postCommentLike);

// 댓글 좋아요 취소 — 로그인 필수
router.delete('/:recipeId/comments/:commentId/likes', authMiddleware, deleteCommentLike);

// 대댓글 목록 조회 — 로그인 선택
router.get('/:recipeId/comments/:commentId/replies', optionalAuthMiddleware, getReplyList);

// 대댓글 작성 — 로그인 필수
router.post('/:recipeId/comments/:commentId/replies', authMiddleware, postReply);

module.exports = router;
