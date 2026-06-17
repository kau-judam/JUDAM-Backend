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

const createPaymentError = (status, message, extra = {}) => {
  const error = new Error(message);
  error.status = status;
  return Object.assign(error, extra);
};

const markFundingPaymentFailed = async ({
  paymentId,
  orderId,
  failureReason,
  rawResponse,
}) => {
  if (!paymentId) {
    return;
  }

  try {
    await pool.query(
      `
      UPDATE payments
      SET
        payment_status = 'FAILED',
        failed_at = CURRENT_TIMESTAMP,
        failure_reason = $2,
        raw_response = $3::jsonb
      WHERE payment_id = $1
        AND payment_status <> 'PAID'
      `,
      [
        paymentId,
        String(failureReason || 'Toss confirm failed').slice(0, 1000),
        JSON.stringify(rawResponse || {}),
      ]
    );

    if (orderId) {
      await pool.query(
        `
        UPDATE orders
        SET
          order_status = 'FAILED',
          updated_at = CURRENT_TIMESTAMP
        WHERE order_id = $1
          AND order_status <> 'PAID'
        `,
        [orderId]
      );
    }
  } catch (markError) {
    console.warn('Failed to mark funding payment as FAILED', {
      paymentId,
      orderId,
      message: markError.message,
    });
  }
};

exports.confirmTossPayment = async ({ paymentKey, orderId, amount, userId }) => {
  const secretKey = process.env.TOSS_SECRET_KEY;
  const numericOrderId = normalizeNumericOrderId(orderId);
  const requestOrderId = String(orderId || '').trim();
  const numericAmount = Number(amount);
  const numericUserId = Number(userId);

  if (!secretKey) {
    throw createPaymentError(500, 'TOSS_SECRET_KEY가 설정되어 있지 않습니다.');
  }

  if (!paymentKey || !orderId || amount === undefined) {
    throw createPaymentError(400, 'paymentKey, orderId, amount는 필수입니다.');
  }

  if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
    throw createPaymentError(401, '로그인이 필요합니다.');
  }

  if (!numericOrderId) {
    throw createPaymentError(
      400,
      'orderId 형식이 올바르지 않습니다. 숫자, order_숫자, funding_order_숫자 형식만 지원합니다.'
    );
  }

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw createPaymentError(400, '결제 승인 금액이 올바르지 않습니다.');
  }

  const client = await pool.connect();
  let order = null;
  let readyPayment = null;
  let shouldMarkFailed = false;
  let tossFailurePayload = null;

  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      `
      SELECT
        order_id,
        user_id,
        funding_id,
        option_id,
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

    order = orderResult.rows[0];
    const fundingAmounts = calculateFundingAmountFromOrder(order);

    if (Number(order.user_id) !== numericUserId) {
      throw createPaymentError(403, '해당 주문에 접근할 권한이 없습니다.');
    }

    if (order.order_status === 'PAID') {
      throw createPaymentError(409, '이미 결제 완료된 주문입니다.');
    }

    if (order.order_status !== 'CREATED') {
      throw createPaymentError(400, '결제 승인 가능한 주문 상태가 아닙니다.');
    }

    if (Number(order.total_amount) !== numericAmount) {
      throw createPaymentError(400, '주문 금액과 결제 승인 금액이 일치하지 않습니다.');
    }

    const readyPaymentResult = await client.query(
      `
      SELECT
        payment_id,
        order_id,
        amount,
        payment_status,
        toss_order_id
      FROM payments
      WHERE order_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
      `,
      [numericOrderId]
    );

    if (readyPaymentResult.rows.length === 0) {
      throw createPaymentError(404, '결제 요청 정보를 찾을 수 없습니다.');
    }

    readyPayment = readyPaymentResult.rows[0];

    if (readyPayment.payment_status === 'PAID') {
      throw createPaymentError(409, '이미 결제 완료된 주문입니다.');
    }

    if (readyPayment.payment_status !== 'READY') {
      throw createPaymentError(400, '결제 승인 가능한 결제 상태가 아닙니다.');
    }

    if (Number(readyPayment.amount) !== numericAmount) {
      throw createPaymentError(400, '결제 요청 금액과 승인 금액이 일치하지 않습니다.');
    }

    const orderedQuantity = Math.max(1, Number(order.quantity || 1));
    let supportOption = null;

    if (order.option_id) {
      const optionResult = await client.query(
        `
        SELECT
          option_id,
          funding_id,
          stock,
          remaining_stock,
          COALESCE(remaining_stock, stock) AS available_stock
        FROM funding_support_options
        WHERE option_id = $1
          AND funding_id = $2
        FOR UPDATE
        `,
        [order.option_id, order.funding_id]
      );

      if (optionResult.rows.length === 0) {
        throw createPaymentError(404, '후원 옵션을 찾을 수 없습니다.');
      }

      supportOption = optionResult.rows[0];

      if (
        supportOption.available_stock !== null
        && supportOption.available_stock !== undefined
        && Number(supportOption.available_stock) < orderedQuantity
      ) {
        throw createPaymentError(400, '후원 옵션 재고가 부족합니다.');
      }
    }

    let tossPayment = null;
    const tossOrderId = readyPayment.toss_order_id || requestOrderId;

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
      shouldMarkFailed = true;

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
      tossFailurePayload = tossPayment;
      const error = new Error('토스 결제가 완료 상태가 아닙니다.');
      error.status = 400;
      throw error;
    }

    if (
      tossPayment?.totalAmount !== undefined &&
      Number(tossPayment.totalAmount) !== numericAmount
    ) {
      tossFailurePayload = tossPayment;
      const error = new Error('토스 승인 금액과 주문 금액이 일치하지 않습니다.');
      error.status = 400;
      throw error;
    }

    shouldMarkFailed = false;

    const paymentResult = await client.query(
      `
      UPDATE payments
      SET
        payment_status = 'PAID',
        payment_key = $1,
        payment_provider = COALESCE(payment_provider, 'TOSS'),
        payment_method = COALESCE($3, payment_method),
        toss_order_id = COALESCE(toss_order_id, $4),
        raw_response = $5::jsonb,
        paid_at = CURRENT_TIMESTAMP,
        failed_at = NULL,
        failure_reason = NULL
      WHERE payment_id = $2
        AND payment_status = 'READY'
      RETURNING payment_id, order_id, payment_status, payment_key, amount, raw_response, paid_at
      `,
      [
        paymentKey,
        readyPayment.payment_id,
        tossPayment?.method || null,
        tossOrderId,
        JSON.stringify(tossPayment || {}),
      ]
    );

    if (paymentResult.rows.length === 0) {
      throw createPaymentError(409, '이미 처리된 결제 요청입니다.');
    }

    await client.query(
      `
      UPDATE orders
      SET
        order_status = 'PAID',
        paid_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE order_id = $1
      `,
      [numericOrderId]
    );

    let remainingStock = supportOption?.remaining_stock;

    if (
      supportOption
      && supportOption.available_stock !== null
      && supportOption.available_stock !== undefined
    ) {
      const stockResult = await client.query(
        `
        UPDATE funding_support_options
        SET remaining_stock = COALESCE(remaining_stock, stock) - $1
        WHERE option_id = $2
          AND funding_id = $3
          AND COALESCE(remaining_stock, stock) >= $1
        RETURNING remaining_stock
        `,
        [orderedQuantity, order.option_id, order.funding_id]
      );

      if (stockResult.rows.length === 0) {
        throw createPaymentError(400, '후원 옵션 재고가 부족합니다.');
      }

      remainingStock = stockResult.rows[0].remaining_stock;
    }

    const hasSupporterCount = await hasTableColumn(client, 'funding_projects', 'supporter_count');
    const fundingResult = await client.query(
      hasSupporterCount
        ? `
          UPDATE funding_projects
          SET
            current_amount = COALESCE(current_amount, 0) + $1,
            supporter_count = COALESCE(supporter_count, 0) + 1,
            updated_at = CURRENT_TIMESTAMP
          WHERE funding_id = $2
          RETURNING funding_id, current_amount, goal_amount, supporter_count
          `
        : `
          UPDATE funding_projects
          SET
            current_amount = COALESCE(current_amount, 0) + $1,
            updated_at = CURRENT_TIMESTAMP
          WHERE funding_id = $2
          RETURNING funding_id, current_amount, goal_amount, NULL::int AS supporter_count
          `,
      [numericAmount, order.funding_id]
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
      paidAmount: numericAmount,
      fundingAmount: numericAmount,
      rewardAmount: fundingAmounts.rewardAmount,
      subtotalAmount: fundingAmounts.subtotalAmount,
      shippingFee: fundingAmounts.shippingFee,
      additionalSupportAmount: fundingAmounts.additionalSupportAmount,
      remainingStock: remainingStock === null || remainingStock === undefined
        ? null
        : Number(remainingStock),
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
    tossFailurePayload = tossError || tossFailurePayload || {
      message: error.message || 'Toss confirm failed',
      code: error.code || null,
    };

    if (shouldMarkFailed && readyPayment?.payment_id) {
      await markFundingPaymentFailed({
        paymentId: readyPayment.payment_id,
        orderId: order?.order_id || numericOrderId,
        failureReason: tossError?.message || error.message || 'Toss confirm failed',
        rawResponse: tossFailurePayload,
      });
    }

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
