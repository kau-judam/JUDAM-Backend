const axios = require('axios');
const pool = require('../config/db');
const {
  createFundingProgressNotificationsForReachedThresholds,
} = require('./breweryDashboardNotification.service');

const normalizeNumericOrderId = (orderId) => {
  const rawOrderId = String(orderId || '').trim();
  const matched = rawOrderId.match(/^(?:funding_order_|order_)?(\d+)$/i);

  if (!matched) {
    return null;
  }

  const numericOrderId = Number(matched[1]);

  return Number.isInteger(numericOrderId) && numericOrderId > 0 ? numericOrderId : null;
};

const toSafeNumber = (value, fallback = 0) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const calculateFundingAmountFromOrder = (order) => {
  const paidAmount = toSafeNumber(order.total_amount);
  const quantity = Math.max(1, toSafeNumber(order.quantity, 1));
  const rewardAmount = Math.max(0, toSafeNumber(order.price_per_bottle) * quantity);
  const shippingFee = Math.max(0, toSafeNumber(order.shipping_fee));
  const donationAmount = toSafeNumber(order.donation_amount);
  const legacyAdditionalSupportAmount = toSafeNumber(order.additional_support_amount);
  const additionalSupportAmount = Math.max(
    0,
    donationAmount > 0 ? donationAmount : legacyAdditionalSupportAmount
  );
  const calculatedFundingAmount = rewardAmount + additionalSupportAmount;
  const fundingAmount =
    calculatedFundingAmount > 0
      ? calculatedFundingAmount
      : Math.max(0, paidAmount - shippingFee);

  return {
    paidAmount,
    fundingAmount,
    rewardAmount,
    subtotalAmount: rewardAmount,
    shippingFee,
    additionalSupportAmount,
  };
};

const isMockTossPaymentAllowed = () =>
  process.env.TOSS_ALLOW_MOCK_PAYMENT === 'true'
  || process.env.NODE_ENV === 'test'
  || process.env.NODE_ENV === 'development';

const hasTableColumn = async (client, tableName, columnName) => {
  const { rows } = await client.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
      AND column_name = $2
    LIMIT 1
    `,
    [tableName, columnName]
  );

  return rows.length > 0;
};

exports.confirmTossPayment = async ({ paymentKey, orderId, amount }) => {
  const secretKey = process.env.TOSS_SECRET_KEY;
  const numericOrderId = normalizeNumericOrderId(orderId);
  const tossOrderId = String(orderId || '').trim();
  const numericAmount = Number(amount);

  if (!secretKey) {
    const error = new Error('TOSS_SECRET_KEY가 설정되어 있지 않습니다.');
    error.status = 500;
    throw error;
  }

  if (!paymentKey || !orderId || amount === undefined) {
    const error = new Error('결제 승인 요청값이 올바르지 않습니다.');
    error.status = 400;
    throw error;
  }

  if (!numericOrderId) {
    const error = new Error('orderId 형식이 올바르지 않습니다. 숫자, order_숫자, funding_order_숫자 형식만 지원합니다.');
    error.status = 400;
    throw error;
  }

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    const error = new Error('결제 승인 금액이 올바르지 않습니다.');
    error.status = 400;
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
        quantity,
        price_per_bottle,
        shipping_fee,
        donation_amount,
        additional_support_amount,
        order_status
      FROM orders
      WHERE order_id = $1
      FOR UPDATE
      `,
      [numericOrderId]
    );

    if (orderResult.rows.length === 0) {
      const error = new Error('주문을 찾을 수 없습니다.');
      error.status = 404;
      throw error;
    }

    const order = orderResult.rows[0];
    const fundingAmounts = calculateFundingAmountFromOrder(order);

    if (order.order_status === 'PAID') {
      const error = new Error('이미 결제 완료된 주문입니다.');
      error.status = 400;
      throw error;
    }

    if (Number(order.total_amount) !== numericAmount) {
      const error = new Error('주문 금액과 결제 승인 금액이 일치하지 않습니다.');
      error.status = 400;
      throw error;
    }

    let readyPaymentResult = await client.query(
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
      [numericOrderId]
    );

    if (readyPaymentResult.rows.length === 0) {
      readyPaymentResult = await client.query(
        `
        INSERT INTO payments (
          order_id,
          payment_method,
          payment_provider,
          amount,
          payment_status
        )
        VALUES ($1, NULL, 'TOSS', $2, 'READY')
        RETURNING payment_id, order_id, amount, payment_status
        `,
        [numericOrderId, numericAmount]
      );
    }

    const readyPayment = readyPaymentResult.rows[0];

    if (Number(readyPayment.amount) !== numericAmount) {
      const error = new Error('결제 요청 금액과 승인 금액이 일치하지 않습니다.');
      error.status = 400;
      throw error;
    }

    let tossPayment = null;

    if (String(paymentKey).startsWith('test_')) {
      if (!isMockTossPaymentAllowed()) {
        const error = new Error('운영 환경에서는 mock paymentKey를 사용할 수 없습니다.');
        error.status = 400;
        throw error;
      }

      tossPayment = {
        paymentKey,
        orderId: tossOrderId,
        totalAmount: numericAmount,
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
          orderId: tossOrderId,
          amount: numericAmount,
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

    if (tossPayment?.status && tossPayment.status !== 'DONE') {
      const error = new Error('토스 결제가 완료 상태가 아닙니다.');
      error.status = 400;
      throw error;
    }

    if (
      tossPayment?.totalAmount !== undefined &&
      Number(tossPayment.totalAmount) !== numericAmount
    ) {
      const error = new Error('토스 승인 금액과 주문 금액이 일치하지 않습니다.');
      error.status = 400;
      throw error;
    }

    const paymentResult = await client.query(
      `
      UPDATE payments
      SET
        payment_status = 'PAID',
        payment_key = $1,
        payment_provider = COALESCE(payment_provider, 'TOSS'),
        payment_method = COALESCE($3, payment_method),
        paid_at = CURRENT_TIMESTAMP
      WHERE payment_id = $2
      RETURNING payment_id, order_id, payment_status, payment_key, amount, paid_at
      `,
      [paymentKey, readyPayment.payment_id, tossPayment?.method || null]
    );

    await client.query(
      `
      UPDATE orders
      SET
        order_status = 'PAID',
        updated_at = CURRENT_TIMESTAMP
      WHERE order_id = $1
      `,
      [numericOrderId]
    );

    const hasSupporterCount = await hasTableColumn(client, 'funding_projects', 'supporter_count');
    const fundingResult = await client.query(
      hasSupporterCount
        ? `
          UPDATE funding_projects
          SET
            current_amount = current_amount + $1,
            supporter_count = COALESCE(supporter_count, 0) + 1,
            updated_at = CURRENT_TIMESTAMP
          WHERE funding_id = $2
          RETURNING funding_id, current_amount, goal_amount, supporter_count
          `
        : `
          UPDATE funding_projects
          SET
            current_amount = current_amount + $1,
            updated_at = CURRENT_TIMESTAMP
          WHERE funding_id = $2
          RETURNING funding_id, current_amount, goal_amount, NULL::int AS supporter_count
          `,
      [fundingAmounts.fundingAmount, order.funding_id]
    );

    const payment = paymentResult.rows[0];
    const funding = fundingResult.rows[0] || {};
    const currentAmount = Number(funding.current_amount || 0);
    const targetAmount = Number(funding.goal_amount || 0);
    const achievementRate =
      targetAmount > 0
        ? Math.floor((currentAmount / targetAmount) * 100)
        : 0;

    await client.query('COMMIT');

    try {
      await createFundingProgressNotificationsForReachedThresholds(order.funding_id);
    } catch (notificationError) {
      console.warn('Failed to create funding progress brewery notifications', {
        fundingId: order.funding_id,
        orderId: order.order_id,
        message: notificationError.message,
      });
    }

    return {
      orderId: String(order.order_id),
      numericOrderId: Number(order.order_id),
      fundingId: order.funding_id === null || order.funding_id === undefined
        ? null
        : String(order.funding_id),
      numericFundingId: order.funding_id === null || order.funding_id === undefined
        ? null
        : Number(order.funding_id),
      paymentStatus: payment.payment_status,
      orderStatus: 'PAID',
      amount: Number(payment.amount),
      paidAmount: fundingAmounts.paidAmount,
      fundingAmount: fundingAmounts.fundingAmount,
      rewardAmount: fundingAmounts.rewardAmount,
      subtotalAmount: fundingAmounts.subtotalAmount,
      shippingFee: fundingAmounts.shippingFee,
      additionalSupportAmount: fundingAmounts.additionalSupportAmount,
      currentAmount,
      targetAmount,
      achievementRate,
      supporterCount: funding.supporter_count === null || funding.supporter_count === undefined
        ? null
        : Number(funding.supporter_count),
      paymentKey: payment.payment_key,
      approvedAt: payment.paid_at,
      tossPayment,
      payment,
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
