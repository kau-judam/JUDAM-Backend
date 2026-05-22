const express = require('express');
const {
  getAiHealth,
  postAiChat,
} = require('../controllers/ai.controller');

const router = express.Router();

router.get('/health', getAiHealth);
router.post('/chat', postAiChat);

module.exports = router;
