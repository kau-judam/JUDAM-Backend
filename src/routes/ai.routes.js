const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');
const {
  getAiHealth,
  postAiChat,
  postAiImageGenerate,
} = require('../controllers/ai.controller');

const router = express.Router();

router.get('/health', getAiHealth);
router.post('/chat', postAiChat);
router.post('/image/generate', authMiddleware, postAiImageGenerate);

module.exports = router;
