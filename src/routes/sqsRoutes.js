const express = require('express');
const router = express.Router();

const authMiddleware = require('../middlewares/authMiddleware');
const { sendSqsTestMessage } = require('../controllers/sqs.controller');

const requireAdmin = (req, res, next) => {
  const role = String(req.user?.role || req.user?.userRole || req.user?.type || '').toUpperCase();

  if (role !== 'ADMIN') {
    return res.status(403).json({
      status: 403,
      message: '관리자만 접근할 수 있습니다.',
    });
  }

  return next();
};

router.post('/test', authMiddleware, requireAdmin, sendSqsTestMessage);

module.exports = router;
