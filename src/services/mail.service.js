let SESClient;
let SendEmailCommand;

try {
  ({ SESClient, SendEmailCommand } = require('@aws-sdk/client-ses'));
} catch (error) {
  SESClient = null;
  SendEmailCommand = null;
}

const getMailProvider = () => String(process.env.MAIL_PROVIDER || '').trim().toLowerCase();

const isProduction = () => process.env.NODE_ENV === 'production';

const getSesClient = () => {
  if (!SESClient) {
    const error = new Error('@aws-sdk/client-ses 패키지가 설치되어 있지 않습니다.');
    error.statusCode = 500;
    throw error;
  }

  const region = process.env.AWS_SES_REGION || process.env.AWS_REGION || 'ap-northeast-2';
  return new SESClient({ region });
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const sendWithSes = async ({ from, to, replyTo, subject, text, html }) => {
  const source = from || process.env.MAIL_FROM;

  if (!source) {
    const error = new Error('MAIL_FROM 환경변수가 설정되어 있지 않습니다.');
    error.statusCode = 500;
    throw error;
  }

  const command = new SendEmailCommand({
    Source: source,
    Destination: {
      ToAddresses: [to],
    },
    ReplyToAddresses: replyTo ? [replyTo] : undefined,
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: subject,
      },
      Body: {
        Text: {
          Charset: 'UTF-8',
          Data: text,
        },
        Html: {
          Charset: 'UTF-8',
          Data: html,
        },
      },
    },
  });

  await getSesClient().send(command);
};

const sendPasswordResetCodeEmail = async ({ to, verificationCode, expiresInMinutes }) => {
  const provider = getMailProvider();
  const subject = '[주담] 비밀번호 재설정 인증번호';
  const text = [
    '주담 비밀번호 재설정 인증번호입니다.',
    '',
    `인증번호: ${verificationCode}`,
    `유효시간: ${expiresInMinutes}분`,
    '',
    '본인이 요청하지 않았다면 이 메일을 무시해주세요.',
  ].join('\n');
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>주담 비밀번호 재설정 인증번호</h2>
      <p>아래 인증번호를 입력해 비밀번호 재설정을 계속 진행해주세요.</p>
      <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${verificationCode}</p>
      <p>유효시간은 ${expiresInMinutes}분입니다.</p>
      <p>본인이 요청하지 않았다면 이 메일을 무시해주세요.</p>
    </div>
  `;

  if (provider === 'ses') {
    await sendWithSes({
      to,
      subject,
      text,
      html,
    });
    return { provider: 'ses', sent: true };
  }

  if (isProduction()) {
    const error = new Error('운영 환경에서는 MAIL_PROVIDER=ses 설정이 필요합니다.');
    error.statusCode = 500;
    throw error;
  }

  console.log('[mail:dev] password reset verification code', {
    to,
    verificationCode,
    expiresInMinutes,
  });

  return { provider: 'console', sent: true };
};

const sendSupportInquiryEmail = async ({ inquiry }) => {
  const from = process.env.SUPPORT_MAIL_FROM || 'judam.aws@gmail.com';
  const to = process.env.SUPPORT_MAIL_TO || 'judam.aws@gmail.com';
  const subject = `[주담 고객센터] ${inquiry.category} - ${inquiry.subject}`;
  const createdAt = inquiry.createdAt
    ? new Date(inquiry.createdAt).toISOString()
    : new Date().toISOString();
  const text = [
    `문의 ID: ${inquiry.inquiryId}`,
    `문의 유형: ${inquiry.category}`,
    `제목: ${inquiry.subject}`,
    '내용:',
    inquiry.content,
    '',
    `답신 이메일: ${inquiry.replyEmail}`,
    `로그인 사용자 ID: ${inquiry.userId || '비회원'}`,
    `로그인 계정 이메일: ${inquiry.accountEmail || '비회원'}`,
    `접수 시각: ${createdAt}`,
  ].join('\n');
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>주담 고객센터 문의</h2>
      <p><strong>문의 ID:</strong> ${escapeHtml(inquiry.inquiryId)}</p>
      <p><strong>문의 유형:</strong> ${escapeHtml(inquiry.category)}</p>
      <p><strong>제목:</strong> ${escapeHtml(inquiry.subject)}</p>
      <p><strong>답신 이메일:</strong> ${escapeHtml(inquiry.replyEmail)}</p>
      <p><strong>로그인 사용자 ID:</strong> ${escapeHtml(inquiry.userId || '비회원')}</p>
      <p><strong>로그인 계정 이메일:</strong> ${escapeHtml(inquiry.accountEmail || '비회원')}</p>
      <p><strong>접수 시각:</strong> ${escapeHtml(createdAt)}</p>
      <hr />
      <pre style="white-space: pre-wrap; font-family: inherit;">${escapeHtml(inquiry.content)}</pre>
    </div>
  `;

  await sendWithSes({
    from,
    to,
    replyTo: inquiry.replyEmail,
    subject,
    text,
    html,
  });

  return { provider: 'ses', sent: true };
};

module.exports = {
  sendPasswordResetCodeEmail,
  sendSupportInquiryEmail,
};
