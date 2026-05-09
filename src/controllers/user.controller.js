const getMyFundingOrders = (req, res) => {
  const { status, page = 0, size = 10 } = req.query;

  if (isNaN(Number(page)) || isNaN(Number(size))) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청 파라미터입니다.',
    });
  }

  return res.status(200).json({
    content: [
      {
        orderId: 1001,
        fundingId: 12,
        fundingTitle: '벚꽃 막걸리 프로젝트',
        thumbnailUrl: 'https://s3.amazonaws.com/judam/funding-thumbnail.png',
        optionName: '벚꽃 막걸리 1병',
        quantity: 2,
        totalAmount: 36000,
        orderStatus: status || 'PAID',
        paymentStatus: 'COMPLETED',
        expectedDeliveryDate: '2026-06-20',
        orderedAt: '2026-05-10T15:30:00',
      },
    ],
    page: Number(page),
    size: Number(size),
    totalElements: 5,
    totalPages: 1,
  });
};

module.exports = {
  getMyFundingOrders
};