const pool = require('../config/db');
const { sendSupportInquiryEmail } = require('./mail.service');

const ALLOWED_INQUIRY_CATEGORIES = new Set([
  'ACCOUNT',
  'FUNDING',
  'PAYMENT',
  'DELIVERY',
  'BREWERY',
  'ETC',
]);
const INQUIRY_CATEGORY_ALIASES = {
  계정: 'ACCOUNT',
  회원: 'ACCOUNT',
  로그인: 'ACCOUNT',
  펀딩: 'FUNDING',
  후원: 'FUNDING',
  결제: 'PAYMENT',
  배송: 'DELIVERY',
  양조장: 'BREWERY',
  기타: 'ETC',
  일반: 'ETC',
};
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SUBJECT_LENGTH = 255;
const MAX_CONTENT_LENGTH = 5000;

const createServiceError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeString = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
};

const normalizeCategory = (category) => {
  const rawCategory = normalizeString(category || 'ETC');
  const normalized = INQUIRY_CATEGORY_ALIASES[rawCategory] || rawCategory.toUpperCase();

  if (!ALLOWED_INQUIRY_CATEGORIES.has(normalized)) {
    throw createServiceError(400, '문의 유형이 올바르지 않습니다.');
  }

  return normalized;
};

const validateInquiryPayload = ({ replyEmail, category, subject, content }) => {
  const normalizedReplyEmail = normalizeString(replyEmail).toLowerCase();
  const normalizedCategory = normalizeCategory(category);
  const normalizedSubject = normalizeString(subject);
  const normalizedContent = normalizeString(content);

  if (!normalizedReplyEmail) {
    throw createServiceError(400, '답신 이메일을 입력해주세요.');
  }

  if (!EMAIL_PATTERN.test(normalizedReplyEmail)) {
    throw createServiceError(400, '답신 이메일 형식이 올바르지 않습니다.');
  }

  if (!normalizedSubject) {
    throw createServiceError(400, '문의 제목을 입력해주세요.');
  }

  if (normalizedSubject.length > MAX_SUBJECT_LENGTH) {
    throw createServiceError(400, '문의 제목은 255자 이하로 입력해주세요.');
  }

  if (!normalizedContent) {
    throw createServiceError(400, '문의 내용을 입력해주세요.');
  }

  if (normalizedContent.length > MAX_CONTENT_LENGTH) {
    throw createServiceError(400, '문의 내용은 5000자 이하로 입력해주세요.');
  }

  return {
    replyEmail: normalizedReplyEmail,
    category: normalizedCategory,
    subject: normalizedSubject,
    content: normalizedContent,
  };
};

const getAuthenticatedUserEmail = async (userId) => {
  if (!userId) {
    return null;
  }

  const { rows } = await pool.query(
    `
    SELECT email
    FROM users
    WHERE user_id = $1
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [userId],
  );

  if (rows.length === 0) {
    throw createServiceError(401, '유효하지 않거나 만료된 토큰입니다.');
  }

  return rows[0].email || null;
};

const formatMailError = (error) => {
  const message = error?.response?.data
    ? JSON.stringify(error.response.data)
    : error?.message || 'Unknown mail error';

  return message.length > 1000 ? message.slice(0, 1000) : message;
};

const updateInquiryMailStatus = async ({ inquiryId, mailSent, mailError }) => {
  await pool.query(
    `
    UPDATE customer_inquiries
    SET
      mail_sent = $1,
      mail_error = $2,
      updated_at = NOW()
    WHERE inquiry_id = $3
    `,
    [mailSent, mailError, inquiryId],
  );
};

const createCustomerInquiry = async ({ userId, replyEmail, category, subject, content }) => {
  const payload = validateInquiryPayload({
    replyEmail,
    category,
    subject,
    content,
  });
  const numericUserId = userId ? Number(userId) : null;
  const accountEmail = await getAuthenticatedUserEmail(numericUserId);
  const { rows } = await pool.query(
    `
    INSERT INTO customer_inquiries (
      user_id,
      account_email,
      reply_email,
      category,
      subject,
      content
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING
      inquiry_id,
      user_id,
      account_email,
      reply_email,
      category,
      subject,
      content,
      created_at
    `,
    [
      numericUserId,
      accountEmail,
      payload.replyEmail,
      payload.category,
      payload.subject,
      payload.content,
    ],
  );
  const inquiry = rows[0];
  const inquiryForMail = {
    inquiryId: inquiry.inquiry_id,
    userId: inquiry.user_id,
    accountEmail: inquiry.account_email,
    replyEmail: inquiry.reply_email,
    category: inquiry.category,
    subject: inquiry.subject,
    content: inquiry.content,
    createdAt: inquiry.created_at,
  };

  try {
    await sendSupportInquiryEmail({ inquiry: inquiryForMail });
    await updateInquiryMailStatus({
      inquiryId: inquiry.inquiry_id,
      mailSent: true,
      mailError: null,
    });

    return {
      inquiryId: inquiry.inquiry_id,
      mailSent: true,
    };
  } catch (error) {
    const mailError = formatMailError(error);

    console.warn('[support] inquiry mail send failed', {
      inquiryId: inquiry.inquiry_id,
      message: mailError,
    });

    await updateInquiryMailStatus({
      inquiryId: inquiry.inquiry_id,
      mailSent: false,
      mailError,
    });

    return {
      inquiryId: inquiry.inquiry_id,
      mailSent: false,
    };
  }
};

module.exports = {
  createCustomerInquiry,
};
