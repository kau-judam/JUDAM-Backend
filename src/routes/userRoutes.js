const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const {
  getMe,
  updateMe,
  deleteMe,
  checkNickname,
  getMyFundingOrders,
  getMyLikedFundings,
} = require('../controllers/user.controller');
const { getMyRecipeList, getMyInterestRecipeList, getMyRecipeCommentList } = require('../controllers/mypageController');

router.get('/check-nickname', checkNickname);
router.get('/me', authMiddleware, getMe);
router.patch('/me', authMiddleware, updateMe);
router.delete('/me', authMiddleware, deleteMe);

// 내가 작성한 레시피 목록 — 로그인 필수
router.get('/me/recipes', authMiddleware, getMyRecipeList);

// 내가 관심 등록한 레시피 목록 — 로그인 필수
router.get('/me/interests/recipes', authMiddleware, getMyInterestRecipeList);

// 내가 작성한 레시피 댓글 목록 — 로그인 필수
router.get('/me/recipe-comments', authMiddleware, getMyRecipeCommentList);

//마이페이지 후원 내역 조회
//router.get('/me/funding-orders', authMiddleware, getMyFundingOrders);
router.get('/me/funding-orders', getMyFundingOrders);

router.get('/me/liked-fundings', getMyLikedFundings);

module.exports = router;
