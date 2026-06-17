const express = require('express');
const router = express.Router();

const authMiddleware = require('../middlewares/authMiddleware');
const paymentController = require('../controllers/payment.controller');

router.post('/toss/confirm', authMiddleware, paymentController.confirmTossPayment);

module.exports = router;
