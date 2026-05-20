const axios = require('axios');
const pool = require('../config/db');

exports.confirmTossPayment = async ({ paymentKey, orderId, amount }) => {
  const secretKey = process.env.TOSS_SECRET_KEY;

  if (!secretKey) {
    const error = new Error('TOSS_SECRET_KEY가 설정되지 않았습니다.');
    error.status = 500;
    throw error;
  }

  const orderResult = await pool.query(
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

  const encodedSecretKey = Buffer.from(`${secretKey}:`).toString('base64');

  try {
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

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const paymentResult = await client.query(
        `
        UPDATE payments
        SET
          payment_status = 'PAID',
          paid_at = NOW()
        WHERE order_id = $1
        AND payment_status = 'READY'
        RETURNING payment_id, order_id, payment_status, amount, paid_at
        `,
        [Number(orderId)]
      );

      if (paymentResult.rows.length === 0) {
        const error = new Error('결제 요청 정보를 찾을 수 없습니다.');
        error.status = 404;
        throw error;
      }

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
        tossPayment: tossResponse.data,
        payment: paymentResult.rows[0],
        message: '토스 결제 승인 및 주문 결제 처리가 완료되었습니다.',
      };
    } catch (dbError) {
      await client.query('ROLLBACK');
      throw dbError;
    } finally {
      client.release();
    }
  } catch (error) {
    const tossError = error.response?.data;

    const customError = new Error(
      tossError?.message || error.message || '토스 결제 승인 중 오류가 발생했습니다.'
    );

    customError.status = error.response?.status || error.status || 500;
    customError.code = tossError?.code;
    customError.tossError = tossError;

    throw customError;
  }
};