const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');

router.get('/me', authMiddleware, (req, res) => {
  res.status(200).json({
    message: 'protected route success',
    user: req.user,
  });
});

module.exports = router;