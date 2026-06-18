const express = require('express');
const jwt = require('jsonwebtoken');
const { createSupportInquiry } = require('../controllers/support.controller');

const router = express.Router();

const tolerantOptionalAuthMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    const userId = decoded.userId || decoded.id;

    if (userId) {
      req.user = {
        ...decoded,
        userId,
        id: Number(userId),
      };
    }
  } catch (error) {
    req.user = null;
  }

  return next();
};

router.post('/inquiries', tolerantOptionalAuthMiddleware, createSupportInquiry);

module.exports = router;
