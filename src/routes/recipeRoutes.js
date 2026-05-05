const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const breweryMiddleware = require('../middlewares/breweryMiddleware');
const { postRecipe, getRecipeList, getRecipeDetail, postInterest, deleteInterest, postBreweryRecipe, getBreweryRecipes } = require('../controllers/recipeController');
const { getCommentList, postComment, putComment, deleteCommentHandler, postCommentLike, deleteCommentLike } = require('../controllers/recipeCommentController');

// 레시피 작성 — 로그인 필수 (authMiddleware로 JWT 검증)
router.post('/', authMiddleware, postRecipe);

// 레시피 목록 조회 — 로그인 불필요 (누구나 접근 가능)
router.get('/', getRecipeList);

// 양조장 레시피 등록 — BREWERY 권한 필수 (/:recipeId보다 먼저 정의해야 충돌 방지)
router.post('/brewery', authMiddleware, breweryMiddleware, postBreweryRecipe);

// 양조장 소비자 레시피 확인 — BREWERY 권한 필수 (/:recipeId보다 먼저 정의해야 충돌 방지)
router.get('/brewery', authMiddleware, breweryMiddleware, getBreweryRecipes);

// 레시피 상세 조회 — 로그인 불필요 (누구나 접근 가능)
router.get('/:recipeId', getRecipeDetail);

// 관심 등록 — 로그인 필수 (누가 등록했는지 사용자 식별 필요)
router.post('/:recipeId/interests', authMiddleware, postInterest);

// 관심 해제 — 로그인 필수 (본인이 등록한 관심만 해제 가능)
router.delete('/:recipeId/interests', authMiddleware, deleteInterest);

// 댓글 목록 조회 — 로그인 불필요 (로그인 시 is_liked 반영, 비로그인 시 false)
router.get('/:recipeId/comments', getCommentList);

// 댓글 작성 — 로그인 필수
router.post('/:recipeId/comments', authMiddleware, postComment);

// 댓글 수정 — 로그인 필수, 작성자 본인만
router.put('/:recipeId/comments/:commentId', authMiddleware, putComment);

// 댓글 삭제 — 로그인 필수, 작성자 본인만
router.delete('/:recipeId/comments/:commentId', authMiddleware, deleteCommentHandler);

// 댓글 좋아요 등록 — 로그인 필수, 중복 좋아요 불가
router.post('/:recipeId/comments/:commentId/likes', authMiddleware, postCommentLike);

// 댓글 좋아요 취소 — 로그인 필수
router.delete('/:recipeId/comments/:commentId/likes', authMiddleware, deleteCommentLike);

module.exports = router;
