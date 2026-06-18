const express = require('express');
const optionalAuthMiddleware = require('../middlewares/optionalAuthMiddleware');
const { createSupportInquiry } = require('../controllers/support.controller');

const router = express.Router();

router.post('/inquiries', optionalAuthMiddleware, createSupportInquiry);

module.exports = router;
