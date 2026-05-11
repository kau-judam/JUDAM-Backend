//결제요청
const express = require('express');
const { requestPayment,
        getOrderDetail,
        getPaymentInfo,
 } = require('../controllers/order.controller');

const router = express.Router();

router.post('/:orderId/payment', requestPayment);
router.get('/:orderId', getOrderDetail);
router.get('/:orderId/payment', getPaymentInfo);

module.exports = router;