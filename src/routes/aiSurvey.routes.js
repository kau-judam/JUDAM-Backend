const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');

const { convertSurveyController } = require('../controllers/aiSurvey.controller');

const router = express.Router();

router.post('/convert', authMiddleware, convertSurveyController);

module.exports = router;
