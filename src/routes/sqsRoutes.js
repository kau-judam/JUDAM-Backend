const express = require('express');
const router = express.Router();

const { sendSqsTestMessage } = require('../controllers/sqs.controller');

router.post('/test', sendSqsTestMessage);

module.exports = router;