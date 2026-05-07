const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { getMe } = require('../controllers/user.controller');
const { getMyRecipeList, getMyInterestRecipeList, getMyRecipeCommentList } = require('../controllers/mypageController');

router.get('/me', authMiddleware, getMe);

// 내가 작성한 레시피 목록 — 로그인 필수
router.get('/me/recipes', authMiddleware, getMyRecipeList);

// 내가 관심 등록한 레시피 목록 — 로그인 필수
router.get('/me/interests/recipes', authMiddleware, getMyInterestRecipeList);

// 내가 작성한 레시피 댓글 목록 — 로그인 필수
router.get('/me/recipe-comments', authMiddleware, getMyRecipeCommentList);

module.exports = router;
