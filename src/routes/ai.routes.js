const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');
const {
  getAiHealth,
  postAiChat,
  getAiRecommend,
  postAiImageGenerate,
} = require('../controllers/ai.controller');

const router = express.Router();

router.get('/health', getAiHealth);
router.post('/chat', postAiChat);
router.get('/recommend', authMiddleware, getAiRecommend);
router.post('/image/generate', authMiddleware, postAiImageGenerate);

module.exports = router;
