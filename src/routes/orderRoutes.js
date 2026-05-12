//결제요청
const express = require('express');
const { requestPayment,
        getOrderDetail,
        getPaymentInfo,
        completePayment,
 } = require('../controllers/order.controller');

const router = express.Router();

router.post('/:orderId/payment', requestPayment);
router.get('/:orderId/payment', getPaymentInfo);
router.patch('/:orderId/payment/complete', completePayment);
router.get('/:orderId', getOrderDetail);

module.exports = router;