const axios = require('axios');
const pool = require('../config/db');

exports.confirmTossPayment = async ({ paymentKey, orderId, amount }) => {
  const secretKey = process.env.TOSS_SECRET_KEY;

  if (!secretKey) {
    const error = new Error('TOSS_SECRET_KEY가 설정되지 않았습니다.');
    error.status = 500;
    throw error;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      `
      SELECT
        order_id,
        funding_id,
        total_amount,
        order_status
      FROM orders
      WHERE order_id = $1
      `,
      [Number(orderId)]
    );

    if (orderResult.rows.length === 0) {
      const error = new Error('주문을 찾을 수 없습니다.');
      error.status = 404;
      throw error;
    }

    const order = orderResult.rows[0];

    if (order.order_status === 'PAID') {
      const error = new Error('이미 결제 완료된 주문입니다.');
      error.status = 400;
      throw error;
    }

    if (Number(order.total_amount) !== Number(amount)) {
      const error = new Error('주문 금액과 결제 승인 금액이 일치하지 않습니다.');
      error.status = 400;
      throw error;
    }

    /**
     * 중요:
     * 결제 요청 단계에서는 payment_key가 아직 DB에 없음.
     * 그래서 payment_key로 찾으면 안 되고,
     * order_id + READY 상태로 가장 최근 결제 요청을 찾아야 함.
     */
    const readyPaymentResult = await client.query(
      `
      SELECT
        payment_id,
        order_id,
        amount,
        payment_status
      FROM payments
      WHERE order_id = $1
      AND payment_status = 'READY'
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [Number(orderId)]
    );

    if (readyPaymentResult.rows.length === 0) {
      const error = new Error('결제 시간이 만료되어 결제 진행 데이터가 존재하지 않습니다.');
      error.status = 404;
      throw error;
    }

    const readyPayment = readyPaymentResult.rows[0];

    if (Number(readyPayment.amount) !== Number(amount)) {
      const error = new Error('결제 요청 금액과 승인 금액이 일치하지 않습니다.');
      error.status = 400;
      throw error;
    }

    let tossPayment = null;

    /**
     * 로컬/Postman 테스트용:
     * paymentKey가 test_ 로 시작하면 실제 토스 API를 호출하지 않고 mock 승인 처리.
     */
    if (String(paymentKey).startsWith('test_')) {
      tossPayment = {
        paymentKey,
        orderId: String(orderId),
        totalAmount: Number(amount),
        status: 'DONE',
        method: 'CARD',
        approvedAt: new Date().toISOString(),
        mock: true,
      };
    } else {
      const encodedSecretKey = Buffer.from(`${secretKey}:`).toString('base64');

      const tossResponse = await axios.post(
        'https://api.tosspayments.com/v1/payments/confirm',
        {
          paymentKey,
          orderId: String(orderId),
          amount: Number(amount),
        },
        {
          headers: {
            Authorization: `Basic ${encodedSecretKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      tossPayment = tossResponse.data;
    }

    const paymentResult = await client.query(
      `
      UPDATE payments
      SET
        payment_status = 'PAID',
        payment_key = $1,
        paid_at = CURRENT_TIMESTAMP
      WHERE payment_id = $2
      RETURNING payment_id, order_id, payment_status, payment_key, amount, paid_at
      `,
      [paymentKey, readyPayment.payment_id]
    );

    await client.query(
      `
      UPDATE orders
      SET order_status = 'PAID'
      WHERE order_id = $1
      `,
      [Number(orderId)]
    );

    await client.query(
      `
      UPDATE funding_projects
      SET current_amount = current_amount + $1
      WHERE funding_id = $2
      `,
      [Number(amount), order.funding_id]
    );

    await client.query('COMMIT');

    return {
      tossPayment,
      payment: paymentResult.rows[0],
      message: '토스 결제 승인 및 주문 결제 처리가 완료되었습니다.',
    };
  } catch (error) {
    await client.query('ROLLBACK');

    const tossError = error.response?.data;

    const customError = new Error(
      tossError?.message || error.message || '토스 결제 승인 중 오류가 발생했습니다.'
    );

    customError.status = error.response?.status || error.status || 500;
    customError.code = tossError?.code;
    customError.tossError = tossError;

    throw customError;
  } finally {
    client.release();
  }
};