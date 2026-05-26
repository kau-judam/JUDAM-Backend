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
  getRecentShippingAddress,
} = require('../controllers/user.controller');
const {
  getMyRecipeList,
  getMyInterestRecipeList,
  getMyRecipeCommentList,
  getMyPostList,
  getMyLikedPostList,
  getMyPostCommentList,
} = require('../controllers/mypageController');

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

// 내가 작성한 게시글 목록 — 로그인 필수 (최근 3개)
router.get('/me/posts', authMiddleware, getMyPostList);

// 내가 좋아요 누른 게시글 목록 — 로그인 필수
router.get('/me/likes/posts', authMiddleware, getMyLikedPostList);

// 내가 작성한 게시글 댓글 목록 — 로그인 필수
router.get('/me/post-comments', authMiddleware, getMyPostCommentList);

//마이페이지 후원 내역 조회
//router.get('/me/funding-orders', authMiddleware, getMyFundingOrders);
router.get('/me/funding-orders', getMyFundingOrders);

router.get('/me/liked-fundings', getMyLikedFundings);

//최근배송지 불러오기
router.get('/me/recent-shipping-address', authMiddleware, getRecentShippingAddress);

module.exports = router;
