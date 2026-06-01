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

const sendWithSes = async ({ to, subject, text, html }) => {
  const from = process.env.MAIL_FROM;

  if (!from) {
    const error = new Error('MAIL_FROM 환경변수가 설정되어 있지 않습니다.');
    error.statusCode = 500;
    throw error;
  }

  const command = new SendEmailCommand({
    Source: from,
    Destination: {
      ToAddresses: [to],
    },
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

module.exports = {
  sendPasswordResetCodeEmail,
};
