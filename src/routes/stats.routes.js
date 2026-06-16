const express = require('express');
const {
  getStatsSummary,
} = require('../controllers/stats.controller');

const router = express.Router();

router.get('/summary', getStatsSummary);

module.exports = router;
