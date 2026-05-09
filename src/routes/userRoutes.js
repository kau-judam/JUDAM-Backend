const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');



const {
  getMyFundingOrders,
} = require('../controllers/user.controller.js');

router.get('/me', authMiddleware, (req, res) => {
  res.status(200).json({
    message: 'protected route success',
    user: req.user,
  });
});

//마이페이지 후원 내역 조회
router.get( '/me/funding-orders', getMyFundingOrders);

module.exports = router;