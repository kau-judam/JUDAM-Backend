const pool = require('../config/db');

// 결제 요청
const requestPayment = async (req, res) => {
  const { orderId } = req.params;
  const {
    paymentMethod,
    paymentProvider,
    amount,
    successUrl,
    failUrl,
  } = req.body;

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

  try {
    const orderResult = await pool.query(
      `
      SELECT order_id, total_amount, order_status
      FROM orders
      WHERE order_id = $1
      `,
      [Number(orderId)]
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

    const basePaymentUrl = `https://payment.example.com/pay/${orderId}`;

    const paymentUrl =
      successUrl || failUrl
        ? `${basePaymentUrl}?successUrl=${encodeURIComponent(successUrl || '')}&failUrl=${encodeURIComponent(failUrl || '')}`
        : basePaymentUrl;

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
        Number(orderId),
        paymentMethod,
        paymentProvider,
        Number(amount),
        paymentUrl,
      ]
    );

    const payment = paymentResult.rows[0];

    return res.status(200).json({
      orderId: payment.order_id,
      paymentId: payment.payment_id,
      paymentStatus: payment.payment_status,
      paymentUrl: payment.payment_url,
      checkoutUrl: payment.payment_url,
      createdAt: payment.created_at,
      message: '결제 요청이 생성되었습니다.',
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

// 주문 상세 조회
const getOrderDetail = async (req, res) => {
  const { orderId } = req.params;

  if (!orderId || isNaN(Number(orderId))) {
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
      LEFT JOIN payments p ON o.order_id = p.order_id
      WHERE o.order_id = $1
      ORDER BY p.created_at DESC
      LIMIT 1
      `,
      [Number(orderId)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '주문을 찾을 수 없습니다.',
      });
    }

    const order = result.rows[0];

    return res.status(200).json({
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

// 결제 정보 조회
const getPaymentInfo = async (req, res) => {
  const { orderId } = req.params;

  if (!orderId || isNaN(Number(orderId))) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청입니다.',
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        payment_id,
        order_id,
        payment_method,
        payment_provider,
        payment_status,
        amount,
        paid_at,
        created_at
      FROM payments
      WHERE order_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [Number(orderId)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '결제 정보를 찾을 수 없습니다.',
      });
    }

    const payment = result.rows[0];

    return res.status(200).json({
      paymentId: payment.payment_id,
      orderId: payment.order_id,
      paymentMethod: payment.payment_method,
      paymentProvider: payment.payment_provider,
      paymentStatus: payment.payment_status,
      amount: payment.amount,
      approvedAt: payment.paid_at,
      createdAt: payment.created_at,
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

// 결제 완료 처리
const completePayment = async (req, res) => {
  const { orderId } = req.params;

  if (!orderId || isNaN(Number(orderId))) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 주문 ID입니다.',
    });
  }

  try {
    // 주문 조회
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
      return res.status(404).json({
        status: 404,
        message: '주문을 찾을 수 없습니다.',
      });
    }

    const order = orderResult.rows[0];

    // 결제 조회
    const paymentResult = await pool.query(
      `
      SELECT
        payment_id,
        payment_status,
        amount
      FROM payments
      WHERE order_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [Number(orderId)]
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

    // payments 상태 변경
    await pool.query(
      `
      UPDATE payments
      SET
        payment_status = 'PAID',
        paid_at = NOW()
      WHERE payment_id = $1
      `,
      [payment.payment_id]
    );

    // orders 상태 변경
    await pool.query(
      `
      UPDATE orders
      SET order_status = 'PAID'
      WHERE order_id = $1
      `,
      [Number(orderId)]
    );

    // funding 현재 금액 증가
    await pool.query(
      `
      UPDATE funding_projects
      SET current_amount = current_amount + $1
      WHERE funding_id = $2
      `,
      [payment.amount, order.funding_id]
    );

    return res.status(200).json({
      orderId: order.order_id,
      paymentId: payment.payment_id,
      paymentStatus: 'PAID',
      paidAmount: payment.amount,
      message: '결제가 완료되었습니다.',
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