const express = require('express');
const router = express.Router();

const paymentController = require('../controllers/payment.controller');

router.post('/toss/confirm', paymentController.confirmTossPayment);

module.exports = router;