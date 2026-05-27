const pool = require('../config/db');

const normalizeNumericOrderId = (orderId) => {
  const normalized = String(orderId || '').trim().replace(/^order_/i, '');
  const numericOrderId = Number(normalized);

  return Number.isInteger(numericOrderId) && numericOrderId > 0 ? numericOrderId : null;
};

const requestPayment = async (req, res) => {
  const numericOrderId = normalizeNumericOrderId(req.params.orderId);
  const {
    paymentMethod = 'CARD',
    paymentProvider = 'TOSS',
    amount,
    successUrl,
    failUrl,
  } = req.body || {};

  if (!numericOrderId) {
    return res.status(404).json({
      status: 404,
      message: '주문을 찾을 수 없습니다.',
    });
  }

  if (!amount || !Number.isFinite(Number(amount))) {
    return res.status(400).json({
      status: 400,
      message: '결제 요청값이 올바르지 않습니다.',
    });
  }

  try {
    const orderResult = await pool.query(
      `
      SELECT
        o.order_id,
        o.total_amount,
        o.order_status,
        o.quantity,
        fp.title AS funding_title,
        u.nickname,
        u.email,
        u.phone_number
      FROM orders o
      LEFT JOIN funding_projects fp ON fp.funding_id = o.funding_id
      LEFT JOIN users u ON u.user_id = o.user_id
      WHERE o.order_id = $1
      `,
      [numericOrderId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '주문을 찾을 수 없습니다.',
      });
    }

    const order = orderResult.rows[0];

    if (Number(amount) !== Number(order.total_amount)) {
      return res.status(400).json({
        status: 400,
        message: '주문 금액과 결제 요청 금액이 일치하지 않습니다.',
      });
    }

    if (order.order_status === 'PAID') {
      return res.status(400).json({
        status: 400,
        message: '이미 결제 완료된 주문입니다.',
      });
    }

    const checkoutUrl = successUrl || failUrl
      ? `toss://payments?successUrl=${encodeURIComponent(successUrl || '')}&failUrl=${encodeURIComponent(failUrl || '')}`
      : null;

    const paymentResult = await pool.query(
      `
      INSERT INTO payments (
        order_id,
        payment_method,
        payment_provider,
        amount,
        payment_status,
        payment_url
      )
      VALUES ($1, $2, $3, $4, 'READY', $5)
      RETURNING payment_id, order_id, payment_status, payment_url, created_at
      `,
      [
        numericOrderId,
        paymentMethod,
        paymentProvider,
        Number(amount),
        checkoutUrl,
      ]
    );

    const payment = paymentResult.rows[0];
    const orderName = `${order.funding_title || '펀딩 후원'} ${order.quantity || 1}병`;
    const responseData = {
      orderId: String(payment.order_id),
      numericOrderId: Number(payment.order_id),
      paymentId: payment.payment_id,
      paymentStatus: payment.payment_status,
      amount: Number(amount),
      orderName,
      customerName: order.nickname || null,
      customerEmail: order.email || null,
      customerMobilePhone: order.phone_number || null,
      paymentUrl: payment.payment_url,
      checkoutUrl: payment.payment_url || null,
      createdAt: payment.created_at,
    };

    return res.status(200).json({
      status: 200,
      message: '결제 요청 생성 성공',
      data: responseData,
      ...responseData,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '결제 요청 생성 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const getOrderDetail = async (req, res) => {
  const numericOrderId = normalizeNumericOrderId(req.params.orderId);

  if (!numericOrderId) {
    return res.status(404).json({
      status: 404,
      message: '주문을 찾을 수 없습니다.',
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        o.order_id,
        o.funding_id,
        fp.title AS funding_title,
        fso.name AS option_name,
        o.quantity,
        o.total_amount,
        o.order_status,
        p.payment_status,
        o.recipient_name,
        o.recipient_phone,
        o.shipping_address,
        o.shipping_detail_address,
        o.created_at,
        o.donation_amount,
        o.shipping_fee,
        o.supporter_email,
        o.support_message,
        o.postal_code
      FROM orders o
      LEFT JOIN funding_projects fp ON o.funding_id = fp.funding_id
      LEFT JOIN funding_support_options fso ON o.option_id = fso.option_id
      LEFT JOIN LATERAL (
        SELECT payment_status
        FROM payments
        WHERE order_id = o.order_id
        ORDER BY created_at DESC
        LIMIT 1
      ) p ON TRUE
      WHERE o.order_id = $1
      `,
      [numericOrderId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '주문을 찾을 수 없습니다.',
      });
    }

    const order = result.rows[0];
    const responseData = {
      orderId: order.order_id,
      fundingId: order.funding_id,
      fundingTitle: order.funding_title,
      optionName: order.option_name,
      quantity: order.quantity,
      totalAmount: order.total_amount,
      orderStatus: order.order_status,
      paymentStatus: order.payment_status || 'PENDING',
      recipientName: order.recipient_name,
      recipientPhone: order.recipient_phone,
      shippingAddress: order.shipping_address,
      shippingDetailAddress: order.shipping_detail_address,
      createdAt: order.created_at,
      donationAmount: order.donation_amount,
      shippingFee: order.shipping_fee,
      supporterEmail: order.supporter_email,
      supportMessage: order.support_message,
      postalCode: order.postal_code,
    };

    return res.status(200).json({
      status: 200,
      message: '주문 상세 조회 성공',
      data: responseData,
      ...responseData,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '주문 상세 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const getPaymentInfo = async (req, res) => {
  const numericOrderId = normalizeNumericOrderId(req.params.orderId);

  if (!numericOrderId) {
    return res.status(400).json({
      status: 400,
      message: '주문 ID가 올바르지 않습니다.',
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        o.order_id,
        o.funding_id,
        o.order_status,
        o.total_amount,
        p.payment_id,
        p.payment_method,
        p.payment_provider,
        p.payment_status,
        p.amount,
        p.payment_key,
        p.payment_url,
        p.paid_at,
        p.created_at
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT *
        FROM payments
        WHERE order_id = o.order_id
        ORDER BY created_at DESC
        LIMIT 1
      ) p ON TRUE
      WHERE o.order_id = $1
      `,
      [numericOrderId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '주문을 찾을 수 없습니다.',
      });
    }

    const payment = result.rows[0];
    const responseData = {
      paymentId: payment.payment_id,
      orderId: String(payment.order_id),
      numericOrderId: Number(payment.order_id),
      fundingId: payment.funding_id === null || payment.funding_id === undefined
        ? null
        : String(payment.funding_id),
      numericFundingId: payment.funding_id === null || payment.funding_id === undefined
        ? null
        : Number(payment.funding_id),
      paymentMethod: payment.payment_method,
      paymentProvider: payment.payment_provider,
      paymentStatus: payment.payment_status || 'PENDING',
      orderStatus: payment.order_status,
      amount: payment.amount === null || payment.amount === undefined
        ? Number(payment.total_amount)
        : Number(payment.amount),
      paymentKey: payment.payment_key || null,
      paymentUrl: payment.payment_url || null,
      checkoutUrl: payment.payment_url || null,
      approvedAt: payment.paid_at,
      createdAt: payment.created_at,
    };

    return res.status(200).json({
      status: 200,
      message: '결제 정보 조회 성공',
      data: responseData,
      ...responseData,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '결제 정보 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

const completePayment = async (req, res) => {
  const numericOrderId = normalizeNumericOrderId(req.params.orderId);

  if (!numericOrderId) {
    return res.status(400).json({
      status: 400,
      message: '주문 ID가 올바르지 않습니다.',
    });
  }

  try {
    const orderResult = await pool.query(
      `
      SELECT order_id, funding_id, total_amount, order_status
      FROM orders
      WHERE order_id = $1
      `,
      [numericOrderId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '주문을 찾을 수 없습니다.',
      });
    }

    const order = orderResult.rows[0];

    const paymentResult = await pool.query(
      `
      SELECT payment_id, payment_status, amount
      FROM payments
      WHERE order_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [numericOrderId]
    );

    if (paymentResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '결제 정보가 없습니다.',
      });
    }

    const payment = paymentResult.rows[0];

    if (payment.payment_status === 'PAID') {
      return res.status(400).json({
        status: 400,
        message: '이미 결제 완료된 주문입니다.',
      });
    }

    await pool.query(
      `
      UPDATE payments
      SET payment_status = 'PAID', paid_at = CURRENT_TIMESTAMP
      WHERE payment_id = $1
      `,
      [payment.payment_id]
    );

    await pool.query(
      `
      UPDATE orders
      SET order_status = 'PAID', updated_at = CURRENT_TIMESTAMP
      WHERE order_id = $1
      `,
      [numericOrderId]
    );

    await pool.query(
      `
      UPDATE funding_projects
      SET current_amount = current_amount + $1
      WHERE funding_id = $2
      `,
      [payment.amount, order.funding_id]
    );

    return res.status(200).json({
      status: 200,
      message: '결제가 완료되었습니다.',
      data: {
        orderId: String(order.order_id),
        paymentId: payment.payment_id,
        paymentStatus: 'PAID',
        paidAmount: payment.amount,
      },
      orderId: order.order_id,
      paymentId: payment.payment_id,
      paymentStatus: 'PAID',
      paidAmount: payment.amount,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '결제 완료 처리 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

module.exports = {
  requestPayment,
  getOrderDetail,
  getPaymentInfo,
  completePayment,
};
