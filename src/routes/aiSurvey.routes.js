const express = require('express');

const { convertSurveyController } = require('../controllers/aiSurvey.controller');

const router = express.Router();

router.post('/convert', convertSurveyController);

module.exports = router;
