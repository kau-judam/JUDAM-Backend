const express = require('express');
const { getAiHealth } = require('../controllers/ai.controller');

const router = express.Router();

router.get('/health', getAiHealth);

module.exports = router;
