const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware'); // JWT 토큰 검증 미들웨어
const { postRecipe, getRecipeList, getRecipeDetail, postInterest, deleteInterest } = require('../controllers/recipeController');

// 레시피 작성 — 로그인 필수 (authMiddleware로 JWT 검증)
router.post('/', authMiddleware, postRecipe);

// 레시피 목록 조회 — 로그인 불필요 (누구나 접근 가능)
router.get('/', getRecipeList);

// 레시피 상세 조회 — 로그인 불필요 (누구나 접근 가능)
router.get('/:recipeId', getRecipeDetail);

// 관심 등록 — 로그인 필수 (누가 등록했는지 사용자 식별 필요)
router.post('/:recipeId/interests', authMiddleware, postInterest);

// 관심 해제 — 로그인 필수 (본인이 등록한 관심만 해제 가능)
router.delete('/:recipeId/interests', authMiddleware, deleteInterest);

module.exports = router;
