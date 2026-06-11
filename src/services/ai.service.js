const axios = require('axios');
const { uploadBufferToS3 } = require('./s3.service');

const DEFAULT_IMAGE_MIME_TYPE = 'image/png';
const AI_IMAGE_GENERATION_TIMEOUT_MS = 60000;
const AI_FUNDING_REGISTER_TIMEOUT_MS = 30000;
const AI_LAW_FILTER_TIMEOUT_MS = 30000;
const AI_TASTE_UPDATE_TIMEOUT_MS = 30000;
const AI_DRINK_REQUEST_TIMEOUT_MS = 30000;
const AI_BREWERY_OCR_TIMEOUT_MS = 30000;

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

const LAW_FILTER_VERDICTS = new Set(['block', 'pass', 'review']);

const normalizeLawFilterVerdict = (aiResponse = {}) => {
  const verdict = typeof aiResponse.verdict === 'string'
    ? aiResponse.verdict.trim().toLowerCase()
    : '';

  if (LAW_FILTER_VERDICTS.has(verdict)) {
    return verdict;
  }

  if (aiResponse.violation === true) {
    return 'block';
  }

  if (aiResponse.violation === false) {
    return 'pass';
  }

  return null;
};

const normalizeAiImagePayload = (payload = {}) => {
  const normalizedPayload = {
    ...(payload && typeof payload === 'object' ? payload : {}),
  };

  if (
    normalizedPayload.taste_vector === undefined &&
    normalizedPayload.tasteVector !== undefined
  ) {
    normalizedPayload.taste_vector = normalizedPayload.tasteVector;
  }

  if (
    normalizedPayload.seed === undefined &&
    normalizedPayload.imageSeed !== undefined
  ) {
    normalizedPayload.seed = normalizedPayload.imageSeed;
  }

  return normalizedPayload;
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

const requestAiChatStream = async ({
  message,
  userId,
  history,
  signal,
}) => {
  const baseUrl = getAiServerBaseUrl();
  const body = {
    message,
    history,
  };

  if (userId !== undefined && userId !== null) {
    body.user_id = userId;
  }

  try {
    return await axios.post(`${baseUrl}/api/chat/stream`, body, {
      responseType: 'stream',
      timeout: 30000,
      signal,
      headers: {
        Accept: 'text/event-stream',
      },
    });
  } catch (error) {
    if (error.code === 'ERR_CANCELED' || error.name === 'CanceledError') {
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

const updateAiTasteProfile = async (payload) => {
  let baseUrl;

  try {
    baseUrl = getAiServerBaseUrl();

    const response = await axios.post(`${baseUrl}/api/taste/update`, payload, {
      timeout: AI_TASTE_UPDATE_TIMEOUT_MS,
    });
    const aiResponse = response.data || {};

    if (aiResponse.status && aiResponse.status !== 'success') {
      console.warn('AI taste update returned non-success response', {
        status: aiResponse.status,
        message: aiResponse.message,
      });

      return {
        updated: false,
        message: 'AI 취향 업데이트에 실패했습니다.',
      };
    }

    return {
      updated: true,
      message: aiResponse.message || 'AI 취향 업데이트 성공',
    };
  } catch (error) {
    console.warn('AI taste update failed', {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      data: error.response?.data,
      url: baseUrl ? `${baseUrl}/api/taste/update` : null,
    });

    return {
      updated: false,
      message: 'AI 취향 업데이트에 실패했습니다.',
    };
  }
};

const requestNewDrink = async (payload) => {
  const baseUrl = getAiServerBaseUrl();

  try {
    const response = await axios.post(`${baseUrl}/api/drinks/request`, payload, {
      timeout: AI_DRINK_REQUEST_TIMEOUT_MS,
    });
    const aiResponse = response.data || {};

    if (aiResponse?.status === 'error') {
      throw createAiServiceError(
        400,
        aiResponse.message || getAiErrorMessage(aiResponse),
      );
    }

    return {
      ...aiResponse,
      requestId: aiResponse.request_id ?? aiResponse.requestId ?? null,
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

const approveNewDrinkRequest = async (requestId) => {
  const baseUrl = getAiServerBaseUrl();

  try {
    const response = await axios.post(`${baseUrl}/api/drinks/requests/${requestId}/approve`, null, {
      timeout: AI_DRINK_REQUEST_TIMEOUT_MS,
    });
    const aiResponse = response.data || {};

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

const requestLawFilter = async (payload) => {
  const baseUrl = getAiServerBaseUrl();

  try {
    const response = await axios.post(`${baseUrl}/api/law/filter`, payload, {
      timeout: AI_LAW_FILTER_TIMEOUT_MS,
    });
    const aiResponse = response.data;

    const verdict = normalizeLawFilterVerdict(aiResponse || {});

    if (!aiResponse || !verdict) {
      throw createAiServiceError(502, 'AI ?? ?? ??? ???? ????.');
    }

    return {
      verdict,
      violation: verdict === 'block',
      details: Array.isArray(aiResponse.details) ? aiResponse.details : [],
      recommendation: aiResponse.recommendation || null,
      raw: aiResponse,
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

const requestBreweryLicenseOcr = async ({
  file,
  documentUrl,
  documentKey,
}) => {
  const baseUrl = getAiServerBaseUrl();

  if (!file?.buffer) {
    throw createAiServiceError(400, 'OCR 요청에 사용할 면허 서류 파일이 없습니다.');
  }

  if (typeof FormData === 'undefined' || typeof Blob === 'undefined') {
    throw createAiServiceError(500, '현재 Node 런타임에서 multipart FormData를 사용할 수 없습니다.');
  }

  const form = new FormData();
  const mimeType = file.mimetype || 'application/octet-stream';
  const fileName = file.originalname || 'business-license';

  form.append('file', new Blob([file.buffer], { type: mimeType }), fileName);

  if (documentUrl) {
    form.append('documentUrl', documentUrl);
    form.append('document_url', documentUrl);
  }

  if (documentKey) {
    form.append('documentKey', documentKey);
    form.append('document_key', documentKey);
  }

  try {
    const response = await axios.post(`${baseUrl}/api/brewery/verify-ocr`, form, {
      timeout: AI_BREWERY_OCR_TIMEOUT_MS,
    });

    return response.data || {};
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    if (error.code === 'ECONNABORTED') {
      throw createAiServiceError(504, 'AI OCR 서버 응답 시간이 초과되었습니다.');
    }

    if (error.response) {
      throw createAiServiceError(
        error.response.status || 502,
        getAiErrorMessage(error.response.data) || 'AI OCR 서버 요청에 실패했습니다.',
      );
    }

    if (axios.isAxiosError(error)) {
      throw createAiServiceError(502, 'AI OCR 서버에 연결할 수 없습니다.');
    }

    throw error;
  }
};

const generateAiImageAndUpload = async ({ payload, userId }) => {
  const baseUrl = getAiServerBaseUrl();

  try {
    const response = await axios.post(`${baseUrl}/api/image/generate`, normalizeAiImagePayload(payload), {
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

const generateFundingDraftAiImageAndUpload = async ({ payload, userId }) => {
  const baseUrl = getAiServerBaseUrl();

  try {
    const response = await axios.post(`${baseUrl}/api/image/generate`, normalizeAiImagePayload(payload), {
      timeout: AI_IMAGE_GENERATION_TIMEOUT_MS,
    });
    const aiResponse = response.data || {};
    const aiStatus = aiResponse.status || null;
    const promptUsed = aiResponse.prompt_used || aiResponse.prompt || null;
    const modelUsed = aiResponse.model_used || null;

    if (aiStatus === 'prompt_only') {
      return {
        aiStatus,
        promptUsed,
        modelUsed,
        message: aiResponse.message || 'AI 이미지 생성이 프롬프트만 반환되었습니다.',
      };
    }

    if (aiStatus && aiStatus !== 'success') {
      throw createAiServiceError(502, aiResponse.message || 'AI 이미지 생성 결과가 올바르지 않습니다.');
    }

    const { buffer, mimeType } = parseBase64Image(
      aiResponse.image_base64,
      aiResponse.mime_type || DEFAULT_IMAGE_MIME_TYPE,
    );
    const extension = getImageExtension(mimeType);
    const imageKey = `uploads/${userId}/funding-ai-images/${Date.now()}-generated.${extension}`;
    const uploadedImage = await uploadBufferToS3(buffer, imageKey, mimeType);

    return {
      aiStatus: aiStatus || 'success',
      imageUrl: uploadedImage.url,
      imageKey: uploadedImage.key,
      mimeType,
      promptUsed,
      modelUsed,
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
  requestAiChatStream,
  requestAiRecommend,
  updateAiTasteProfile,
  requestNewDrink,
  approveNewDrinkRequest,
  registerFundingToAiPool,
  requestLawFilter,
  requestBreweryLicenseOcr,
  generateAiImageAndUpload,
  generateFundingDraftAiImageAndUpload,
};
