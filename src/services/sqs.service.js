const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

const region = process.env.AWS_REGION || 'ap-northeast-2';

const sqsClient = new SQSClient({
  region,
});

const AI_TASK_QUEUE_URL = process.env.AWS_SQS_AI_TASK_QUEUE_URL;

/**
 * AI 비동기 작업 메시지를 SQS에 발행합니다.
 *
 * @param {Object} payload - SQS로 보낼 메시지 본문
 * @returns {Promise<Object>} SQS SendMessage 결과
 */
async function sendAiTaskMessage(payload) {
  if (!AI_TASK_QUEUE_URL) {
    throw new Error('AWS_SQS_AI_TASK_QUEUE_URL is not defined');
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('payload must be an object');
  }

  const messageBody = JSON.stringify({
    ...payload,
    createdAt: new Date().toISOString(),
  });

  const command = new SendMessageCommand({
    QueueUrl: AI_TASK_QUEUE_URL,
    MessageBody: messageBody,
  });

  return sqsClient.send(command);
}

module.exports = {
  sendAiTaskMessage,
};