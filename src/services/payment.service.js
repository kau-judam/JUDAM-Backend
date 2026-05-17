const axios = require('axios');

exports.confirmTossPayment = async ({ paymentKey, orderId, amount }) => {
  const secretKey = process.env.TOSS_SECRET_KEY;

  if (!secretKey) {
    const error = new Error('TOSS_SECRET_KEY가 설정되지 않았습니다.');
    error.status = 500;
    throw error;
  }

  const encodedSecretKey = Buffer.from(`${secretKey}:`).toString('base64');

  try {
    const response = await axios.post(
      'https://api.tosspayments.com/v1/payments/confirm',
      {
        paymentKey,
        orderId,
        amount,
      },
      {
        headers: {
          Authorization: `Basic ${encodedSecretKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  } catch (error) {
    const tossError = error.response?.data;

    const customError = new Error(
      tossError?.message || '토스 결제 승인 중 오류가 발생했습니다.'
    );

    customError.status = error.response?.status || 500;
    customError.code = tossError?.code;
    customError.tossError = tossError;

    throw customError;
  }
};