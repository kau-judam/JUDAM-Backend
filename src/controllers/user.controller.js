const pool = require('../config/db');

const {
  findUserById,
  updateUserProfile,
  deleteUserAccount,
  isNicknameExists
} = require('../services/user.service');

const mapUserResponse = (user) => ({
  userId: String(user.user_id),
  email: user.email,
  nickname: user.nickname,
  role: user.role,
  provider: user.provider,
  profileImage: user.profile_image,
  lastLoginAt: user.last_login_at ? new Date(user.last_login_at).toISOString() : null,
});

const mapUpdatedUserResponse = (user) => ({
  userId: String(user.user_id),
  email: user.email,
  nickname: user.nickname,
  phoneNumber: user.phone_number,
  role: user.role,
  provider: user.provider,
  profileImage: user.profile_image,
  updatedAt: user.updated_at ? new Date(user.updated_at).toISOString() : null,
});

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const getMe = async (req, res) => {
  if (!req.user?.userId) {
    return res.status(401).json({
      status: 401,
      message: '유효하지 않거나 만료된 토큰입니다.',
    });
  }

  try {
    const user = await findUserById(req.user.userId);

    if (!user) {
      return res.status(404).json({
        message: 'user not found',
        error: 'user does not exist',
      });
    }

    return res.status(200).json({
      user: mapUserResponse(user),
    });
  } catch (error) {
    return res.status(500).json({
      message: 'failed to get user',
      error: error.message,
    });
  }
};

const updateMe = async (req, res) => {
  if (!req.user?.userId) {
    return res.status(401).json({
      status: 401,
      message: '유효하지 않거나 만료된 토큰입니다.',
    });
  }

  const body = req.body || {};
  const hasNickname = hasOwn(body, 'nickname');
  const hasPhoneNumber = hasOwn(body, 'phoneNumber');
  const hasProfileImage = hasOwn(body, 'profileImage');

  if (!hasNickname && !hasPhoneNumber && !hasProfileImage) {
    return res.status(400).json({
      message: 'no fields to update',
      error: 'at least one editable field is required',
    });
  }

  const updateData = {};

  if (hasNickname) {
    if (typeof body.nickname !== 'string' || body.nickname.trim() === '') {
      return res.status(400).json({
        message: 'invalid nickname',
        error: 'nickname cannot be empty',
      });
    }

    updateData.nickname = body.nickname.trim();
  }

  if (hasPhoneNumber) {
    updateData.phoneNumber = body.phoneNumber;
  }

  if (hasProfileImage) {
    updateData.profileImage = body.profileImage;
  }

  try {
    const user = await updateUserProfile(req.user.userId, updateData);

    return res.status(200).json({
      message: 'user profile updated',
      user: mapUpdatedUserResponse(user),
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({
        message: 'user not found',
        error: 'user does not exist',
      });
    }

    if (error.statusCode === 409) {
      return res.status(409).json({
        message: 'nickname already exists',
        error: 'duplicate nickname',
      });
    }

    return res.status(500).json({
      message: 'failed to update user',
      error: error.message,
    });
  }
};

const deleteMe = async (req, res) => {
  if (!req.user?.userId) {
    return res.status(401).json({
      status: 401,
      message: '유효하지 않거나 만료된 토큰입니다.',
    });
  }

  try {
    await deleteUserAccount(req.user.userId);

    return res.status(200).json({
      message: 'user deleted successfully',
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({
        message: 'user not found',
        error: 'user does not exist or already deleted',
      });
    }

    return res.status(500).json({
      message: 'failed to delete user',
      error: error.message,
    });
  }
};

const checkNickname = async (req, res) => {
  const nickname = typeof req.query.nickname === 'string' ? req.query.nickname.trim() : '';

  if (!nickname) {
    return res.status(400).json({
      message: 'nickname is required',
      error: 'nickname query parameter is missing',
    });
  }

  try {
    const exists = await isNicknameExists(nickname);

    return res.status(200).json({
      available: !exists,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'failed to check nickname',
      error: error.message,
    });
  }
};

//마이페이지 후원
const getMyFundingOrders = async (req, res) => {
  const { status, page = 0, size = 10 } = req.query;

  const pageNumber = Number(page);
  const sizeNumber = Number(size);

  if (
    Number.isNaN(pageNumber) ||
    Number.isNaN(sizeNumber) ||
    pageNumber < 0 ||
    sizeNumber <= 0
  ) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청 파라미터입니다.',
    });
  }

  // TODO: JWT 완전 연동 후 req.user.userId만 사용
  const userId = req.user?.userId || 1;

  const values = [userId];
  const conditions = ['o.user_id = $1'];

  if (status) {
    values.push(status);
    conditions.push(`o.order_status = $${values.length}`);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  try {
    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS total_count
      FROM orders o
      ${whereClause}
      `,
      values
    );

    const totalElements = countResult.rows[0].total_count;

    const listValues = [
      ...values,
      sizeNumber,
      pageNumber * sizeNumber,
    ];

    const result = await pool.query(
      `
      SELECT
        o.order_id,
        o.funding_id,
        fp.title AS funding_title,
        r.image_url AS thumbnail_url,
        o.option_id,
        o.quantity,
        o.price_per_bottle,
        o.shipping_fee,
        o.donation_amount,
        o.total_amount,
        o.order_status,
        o.created_at AS ordered_at,
        fp.end_date AS expected_delivery_date,
        p.payment_status
      FROM orders o
      JOIN funding_projects fp ON fp.funding_id = o.funding_id
      LEFT JOIN recipes r ON r.recipe_id = fp.recipe_id
      LEFT JOIN LATERAL (
        SELECT payment_status
        FROM payments
        WHERE order_id = o.order_id
        ORDER BY created_at DESC
        LIMIT 1
      ) p ON TRUE
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT $${listValues.length - 1}
      OFFSET $${listValues.length}
      `,
      listValues
    );

    return res.status(200).json({
      content: result.rows.map((order) => ({
        orderId: order.order_id,
        fundingId: order.funding_id,
        fundingTitle: order.funding_title,
        thumbnailUrl: order.thumbnail_url,
        optionId: order.option_id,
        optionName: `${order.quantity}병`,
        quantity: order.quantity,
        pricePerBottle: order.price_per_bottle,
        shippingFee: order.shipping_fee,
        donationAmount: order.donation_amount,
        totalAmount: order.total_amount,
        orderStatus: order.order_status,
        paymentStatus: order.payment_status || null,
        expectedDeliveryDate: order.expected_delivery_date,
        orderedAt: order.ordered_at,
      })),
      page: pageNumber,
      size: sizeNumber,
      totalElements,
      totalPages: Math.ceil(totalElements / sizeNumber),
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '마이페이지 후원 내역 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

//찜한 펀딩 목록 조회
const getMyLikedFundings = async (req, res) => {
    
    //if (!req.user?.userId) {
    //return res.status(401).json({
     // status: 401,
      //message: '유효하지 않거나 만료된 토큰입니다.',
    //});
    const userId = req.user?.userId || 1; //테스트용
  

  try {
    const result = await pool.query(
      `
      SELECT
        fp.funding_id,
        fp.title,
        
        fp.goal_amount,
        fp.current_amount,
        fp.start_date,
        fp.end_date,
        COUNT(fl.like_id) AS like_count
      FROM funding_likes my_like
      JOIN funding_projects fp
        ON my_like.funding_id = fp.funding_id
      LEFT JOIN funding_likes fl
        ON fp.funding_id = fl.funding_id
      WHERE my_like.user_id = $1
      GROUP BY fp.funding_id
      ORDER BY MAX(my_like.created_at) DESC
      `,
      [userId]//[req.user.userId]
    );

    return res.status(200).json({
      content: result.rows.map((funding) => ({
        fundingId: funding.funding_id,
        title: funding.title,
        //thumbnailUrl: funding.thumbnail_url,
        goalAmount: funding.goal_amount,
        currentAmount: funding.current_amount,
        startDate: funding.start_date,
        endDate: funding.end_date,
        liked: true,
        likeCount: Number(funding.like_count),
      })),
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '찜한 펀딩 목록 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

//최근 주문 배송지 불러오기
const getRecentShippingAddress = async (req, res) => {
  const userId = req.user?.userId || 1;

  try {
    const result = await pool.query(
      `
      SELECT
        recipient_name,
        recipient_phone,
        shipping_address,
        shipping_detail_address,
        postal_code
      FROM orders
      WHERE user_id = $1
        AND recipient_name IS NOT NULL
        AND recipient_phone IS NOT NULL
        AND shipping_address IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '최근 배송지 정보가 없습니다.',
      });
    }

    const address = result.rows[0];

    return res.status(200).json({
      recipientName: address.recipient_name,
      recipientPhone: address.recipient_phone,
      shippingAddress: address.shipping_address,
      shippingDetailAddress: address.shipping_detail_address,
      postalCode: address.postal_code,
      message: '최근 배송지 조회 성공',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '최근 배송지 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

module.exports = { getMe, updateMe, deleteMe, checkNickname,
    getMyFundingOrders,
    getMyLikedFundings,
    getRecentShippingAddress,
 };
