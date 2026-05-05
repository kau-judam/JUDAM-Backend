//결제요청
const express = require('express');
const { requestPayment,
        getOrderDetail,
 } = require('../controllers/order.controller');

const router = express.Router();

router.post('/:orderId/payment', requestPayment);
router.get('/:orderId', getOrderDetail);

module.exports = router;