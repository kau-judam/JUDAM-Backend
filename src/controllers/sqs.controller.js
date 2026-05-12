const { sendAiTaskMessage } = require('../services/sqs.service');

const sendSqsTestMessage = async (req, res) => {
  try {
    const payload = {
      type: 'SQS_TEST',
      source: 'backend-api',
      requestedBy: req.user?.id || null,
      body: req.body || {},
    };

    const result = await sendAiTaskMessage(payload);

    return res.status(200).json({
      status: 200,
      message: 'SQS 테스트 메시지 발행 성공',
      data: {
        messageId: result.MessageId,
      },
    });
  } catch (error) {
    console.error('[SQS Test] 메시지 발행 실패:', error);

    return res.status(500).json({
      status: 500,
      message: 'SQS 테스트 메시지 발행 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

module.exports = {
  sendSqsTestMessage,
};