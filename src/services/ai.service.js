const axios = require('axios');
const { uploadBufferToS3 } = require('./s3.service');

const DEFAULT_IMAGE_MIME_TYPE = 'image/png';
const AI_IMAGE_GENERATION_TIMEOUT_MS = 60000;
const AI_FUNDING_REGISTER_TIMEOUT_MS = 30000;

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

const getImageExtension = (mimeType) => {
  const normalizedMimeType = typeof mimeType === 'string'
    ? mimeType.toLowerCase()
    : DEFAULT_IMAGE_MIME_TYPE;

  switch (normalizedMimeType) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/png':
    default:
      return 'png';
  }
};

const parseBase64Image = (imageBase64, fallbackMimeType = DEFAULT_IMAGE_MIME_TYPE) => {
  if (typeof imageBase64 !== 'string' || !imageBase64.trim()) {
    throw createAiServiceError(502, 'AI 이미지 생성 결과가 올바르지 않습니다.');
  }

  const trimmedBase64 = imageBase64.trim();
  const dataUrlMatch = trimmedBase64.match(/^data:([^;]+);base64,([\s\S]*)$/);
  const mimeType = dataUrlMatch?.[1] || fallbackMimeType || DEFAULT_IMAGE_MIME_TYPE;
  const rawBase64 = (dataUrlMatch?.[2] || trimmedBase64).replace(/\s/g, '');

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(rawBase64)) {
    throw createAiServiceError(502, 'AI 이미지 생성 결과가 올바르지 않습니다.');
  }

  const buffer = Buffer.from(rawBase64, 'base64');

  if (buffer.length === 0) {
    throw createAiServiceError(502, 'AI 이미지 생성 결과가 올바르지 않습니다.');
  }

  return {
    buffer,
    mimeType,
  };
};

const getAiErrorMessage = (data) => {
  if (!data) {
    return 'AI 서버 요청에 실패했습니다.';
  }

  if (typeof data === 'string') {
    return data;
  }

  const detail = data.detail || data.message;

  if (typeof detail === 'string') {
    return detail;
  }

  if (Array.isArray(detail)) {
    const firstMessage = detail[0]?.msg;

    if (firstMessage) {
      return firstMessage;
    }

    return JSON.stringify(detail);
  }

  if (detail && typeof detail === 'object') {
    return JSON.stringify(detail);
  }

  return 'AI 서버 요청에 실패했습니다.';
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

const requestAiRecommend = async ({ userId, tasteVector, pool }) => {
  const baseUrl = getAiServerBaseUrl();

  try {
    const response = await axios.post(`${baseUrl}/api/recommend`, {
      user_id: String(userId),
      user_vector: tasteVector,
      pool,
    }, {
      timeout: 30000,
    });

    const aiResponse = response.data;

    if (aiResponse?.status === 'error') {
      throw createAiServiceError(
        400,
        aiResponse.message || getAiErrorMessage(aiResponse),
      );
    }

    return aiResponse;
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

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

const isDuplicateFundingRegisterError = (error) => {
  if (error.response?.status !== 400) {
    return false;
  }

  const message = getAiErrorMessage(error.response.data);
  return message.includes('이미 등록된 funding_id') || message.toLowerCase().includes('already');
};

const registerFundingToAiPool = async (fundingPayload) => {
  const baseUrl = getAiServerBaseUrl();

  try {
    const response = await axios.post(`${baseUrl}/api/funding/register`, fundingPayload, {
      timeout: AI_FUNDING_REGISTER_TIMEOUT_MS,
    });
    const aiResponse = response.data;

    if (aiResponse?.status === 'error') {
      throw createAiServiceError(
        502,
        aiResponse.message || getAiErrorMessage(aiResponse),
      );
    }

    return aiResponse;
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    if (isDuplicateFundingRegisterError(error)) {
      return {
        status: 'success',
        alreadyRegistered: true,
        message: getAiErrorMessage(error.response.data),
      };
    }

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

const generateAiImageAndUpload = async ({ payload, userId }) => {
  const baseUrl = getAiServerBaseUrl();

  try {
    const response = await axios.post(`${baseUrl}/api/image/generate`, payload, {
      timeout: AI_IMAGE_GENERATION_TIMEOUT_MS,
    });
    const aiResponse = response.data || {};
    const { buffer, mimeType } = parseBase64Image(
      aiResponse.image_base64,
      aiResponse.mime_type || DEFAULT_IMAGE_MIME_TYPE,
    );
    const extension = getImageExtension(mimeType);
    const imageKey = `uploads/${userId}/ai-images/${Date.now()}-generated.${extension}`;
    const uploadedImage = await uploadBufferToS3(buffer, imageKey, mimeType);

    return {
      imageUrl: uploadedImage.url,
      imageKey: uploadedImage.key,
      prompt: aiResponse.prompt || null,
      mimeType,
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

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
  requestAiRecommend,
  registerFundingToAiPool,
  generateAiImageAndUpload,
};
