const { createCustomerInquiry } = require('../services/support.service');

const getFirstBodyValue = (body, keys) => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body || {}, key)) {
      return body[key];
    }
  }

  return undefined;
};

const createSupportInquiry = async (req, res) => {
  const body = req.body || {};

  try {
    const inquiry = await createCustomerInquiry({
      userId: req.user?.userId || req.user?.id || null,
      replyEmail: getFirstBodyValue(body, ['replyEmail', 'reply_email', 'email']),
      category: getFirstBodyValue(body, ['category', 'type', 'inquiryType']),
      subject: getFirstBodyValue(body, ['subject', 'title']),
      content: getFirstBodyValue(body, ['content', 'message', 'body']),
    });

    return res.status(201).json({
      status: 201,
      message: '문의가 접수되었습니다.',
      data: {
        inquiryId: Number(inquiry.inquiryId),
        mailSent: Boolean(inquiry.mailSent),
      },
      inquiryId: Number(inquiry.inquiryId),
      mailSent: Boolean(inquiry.mailSent),
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
