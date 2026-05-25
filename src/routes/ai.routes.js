const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');
const {
  getAiHealth,
  postAiChat,
  postAiChatStream,
  getAiRecommend,
  postAiImageGenerate,
  postAiDrinkRequest,
  postAiDrinkRequestApprove,
} = require('../controllers/ai.controller');

const router = express.Router();

router.get('/health', getAiHealth);
router.post('/chat', postAiChat);
router.post('/chat/stream', postAiChatStream);
router.get('/recommend', authMiddleware, getAiRecommend);
router.post('/image/generate', authMiddleware, postAiImageGenerate);
router.post('/drinks/request', authMiddleware, postAiDrinkRequest);
// TODO: Replace authMiddleware with admin authorization when an admin middleware is available.
router.post('/drinks/requests/:requestId/approve', authMiddleware, postAiDrinkRequestApprove);

module.exports = router;
