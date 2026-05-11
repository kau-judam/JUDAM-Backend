//결제요청
const requestPayment = (req, res) => {
  const { orderId } = req.params;

  const { paymentMethod, paymentProvider, amount } = req.body;

  if (!orderId || isNaN(Number(orderId))) {
    return res.status(404).json({
      status: 404,
      message: '주문을 찾을 수 없습니다.',
    });
  }

  if (!paymentMethod || !paymentProvider || !amount || typeof amount !== 'number') {
    return res.status(400).json({
      status: 400,
      message: '결제 요청값이 올바르지 않습니다.',
    });
  }

  const orderAmount = 36000;

  if (amount !== orderAmount) {
    return res.status(400).json({
      status: 400,
      message: '주문 금액과 결제 요청 금액이 일치하지 않습니다.',
    });
  }

  return res.status(200).json({
    orderId: Number(orderId),
    paymentId: 501,
    paymentStatus: 'READY',
    paymentUrl: 'https://payment.example.com/pay/501',
    message: '결제 요청이 생성되었습니다.',
  });
};

//주문상세조회
const getOrderDetail = (req, res) => {
  const { orderId } = req.params;

  if (!orderId || isNaN(Number(orderId))) {
    return res.status(404).json({
      status: 404,
      message: '주문을 찾을 수 없습니다.',
    });
  }

  return res.status(200).json({
    orderId: Number(orderId),
    fundingId: 1,
    fundingTitle: '벚꽃 막걸리 프로젝트',
    optionName: '벚꽃 막걸리 1병',
    quantity: 2,
    totalAmount: 36000,
    orderStatus: 'PAID',
    paymentStatus: 'COMPLETED',
    recipientName: '양재원',
    recipientPhone: '010-1234-5678',
    shippingAddress: '서울특별시 강서구 하늘길 123',
    shippingDetailAddress: '101동 1001호',
    createdAt: '2026-05-01T13:20:00',
  });
};

module.exports = {
  requestPayment,
  getOrderDetail,
};