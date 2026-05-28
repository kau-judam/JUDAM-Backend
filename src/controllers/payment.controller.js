const paymentService = require('../services/payment.service');

exports.confirmTossPayment = async (req, res) => {
  try {
    const { paymentKey, orderId, amount } = req.body || {};

    if (!paymentKey || !orderId || amount === undefined) {
      return res.status(400).json({
        status: 400,
        message: 'paymentKey, orderId, amount는 필수입니다.',
      });
    }

    const result = await paymentService.confirmTossPayment({
      paymentKey,
      orderId,
      amount,
    });

    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      ...result,
      status: 200,
      message: '결제 승인 성공',
      data: result,
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      status: error.status || 500,
      message: error.message || '결제 승인 중 서버 오류가 발생했습니다.',
      ...(error.code ? { code: error.code } : {}),
    });
  }
};
