const axios = require('axios');

const getAiServerBaseUrl = () => {
  const { AI_SERVER_BASE_URL } = process.env;

  if (!AI_SERVER_BASE_URL) {
    const error = new Error('AI_SERVER_BASE_URL environment variable is missing');
    error.statusCode = 500;
    throw error;
  }

  return AI_SERVER_BASE_URL.replace(/\/+$/, '');
};

const checkAiServerHealth = async () => {
  const baseUrl = getAiServerBaseUrl();
  const response = await axios.get(`${baseUrl}/health`);

  return response.data;
};

const createAiServiceError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getAiErrorMessage = (data) => {
  if (!data) {
    return null;
  }

  if (typeof data === 'string') {
    return data;
  }

  return data.message || data.detail || null;
};

const requestAiChat = async ({ message, userId, history }) => {
  const baseUrl = getAiServerBaseUrl();
  const body = {
    message,
    history,
  };

  if (userId !== undefined && userId !== null) {
    body.user_id = userId;
  }

  try {
    const response = await axios.post(`${baseUrl}/api/chat`, body, {
      timeout: 30000,
    });

    return response.data;
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      throw createAiServiceError(504, 'AI 서버 응답 시간이 초과되었습니다.');
    }

    if (error.response) {
      throw createAiServiceError(
        error.response.status || 502,
        getAiErrorMessage(error.response.data) || 'AI 서버와 연결할 수 없습니다.',
      );
    }

    if (axios.isAxiosError(error)) {
      throw createAiServiceError(502, 'AI 서버와 연결할 수 없습니다.');
    }

    throw error;
  }
};

module.exports = {
  checkAiServerHealth,
  requestAiChat,
};
