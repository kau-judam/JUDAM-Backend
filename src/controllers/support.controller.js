const { createCustomerInquiry } = require('../services/support.service');

const createSupportInquiry = async (req, res) => {
  try {
    const inquiry = await createCustomerInquiry({
      userId: req.user?.userId || req.user?.id || null,
      replyEmail: req.body?.replyEmail,
      category: req.body?.category,
      subject: req.body?.subject,
      content: req.body?.content,
    });

    return res.status(201).json({
      status: 201,
      message: '문의가 접수되었습니다.',
      data: {
        inquiryId: Number(inquiry.inquiryId),
      },
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;

    return res.status(statusCode).json({
      status: statusCode,
      message: error.message || '문의 접수 중 서버 오류가 발생했습니다.',
    });
  }
};

module.exports = {
  createSupportInquiry,
};
