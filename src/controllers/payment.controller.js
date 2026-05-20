const paymentService = require('../services/payment.service');

exports.confirmTossPayment = async (req, res, next) => {
  try {
    const { paymentKey, orderId, amount } = req.body;

    if (!paymentKey || !orderId || amount === undefined) {
      return res.status(400).json({
        message: 'paymentKey, orderId, amount는 필수입니다.',
      });
    }

    const result = await paymentService.confirmTossPayment({
      paymentKey,
      orderId,
      amount,
    });

    return res.status(200).json({
      message: '결제 승인에 성공했습니다.',
      payment: result,
    });
  } catch (error) {
    next(error);
  }
};