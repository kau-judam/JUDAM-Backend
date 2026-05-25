const {
  checkAiServerHealth,
  requestAiChat,
  requestAiRecommend,
  generateAiImageAndUpload,
} = require('../services/ai.service');
const { findUserTasteVectorById } = require('../services/user.service');

const ALLOWED_RECOMMEND_POOLS = new Set(['all', 'base', 'funding', 'recipe']);

const getAiHealth = async (req, res) => {
  try {
    const ai = await checkAiServerHealth();

    return res.status(200).json({
      message: 'AI server health check success',
      ai,
    });
  } catch (error) {
    if (error.statusCode === 500) {
      return res.status(500).json({
        message: error.message,
      });
    }

    const errorMessage = error.response?.data || error.message;

    return res.status(500).json({
      message: 'AI server health check failed',
      error: errorMessage,
    });
  }
};

const postAiChat = async (req, res) => {
  const message = typeof req.body?.message === 'string'
    ? req.body.message.trim()
    : '';
  const history = req.body?.history ?? [];
  const userId = req.body?.user_id || 'anonymous';

  if (!message) {
    return res.status(400).json({
      status: 400,
      message: '메시지를 입력해주세요.',
    });
  }

  if (!Array.isArray(history)) {
    return res.status(400).json({
      status: 400,
      message: '대화 이력 형식이 올바르지 않습니다.',
    });
  }

  try {
    const aiResponse = await requestAiChat({
      message,
      userId,
      history,
    });

    return res.status(200).json({
      status: 200,
      message: 'AI 챗봇 응답 성공',
      data: aiResponse,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        status: error.statusCode,
        message: error.message,
      });
    }

    return res.status(500).json({
      status: 500,
      message: 'AI 챗봇 응답 처리 중 서버 오류가 발생했습니다.',
    });
  }
};

const postAiImageGenerate = async (req, res) => {
  const userId = req.user?.userId;

  if (!userId) {
    return res.status(401).json({
      status: 401,
      message: '유효하지 않거나 만료된 토큰입니다.',
    });
  }

  try {
    const data = await generateAiImageAndUpload({
      payload: req.body || {},
      userId,
    });

    return res.status(200).json({
      status: 200,
      message: 'AI 이미지 생성 성공',
      data,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        status: error.statusCode,
        message: error.message,
      });
    }

    return res.status(500).json({
      status: 500,
      message: 'AI 이미지 생성 중 서버 오류가 발생했습니다.',
    });
  }
};

const getAiRecommend = async (req, res) => {
  const userId = req.user?.userId;
  const pool = req.query?.pool || 'all';

  if (!userId) {
    return res.status(401).json({
      status: 401,
      message: '유효하지 않거나 만료된 토큰입니다.',
    });
  }

  if (!ALLOWED_RECOMMEND_POOLS.has(pool)) {
    return res.status(400).json({
      status: 400,
      message: '추천 풀 값이 올바르지 않습니다.',
    });
  }

  try {
    const userTaste = await findUserTasteVectorById(userId);
    const tasteVector = userTaste?.taste_vector;

    if (!tasteVector) {
      return res.status(400).json({
        status: 400,
        message: '술BTI 결과가 필요합니다.',
      });
    }

    const aiResponse = await requestAiRecommend({
      userId,
      tasteVector,
      pool,
    });

    return res.status(200).json({
      status: 200,
      message: 'AI 추천 성공',
      data: aiResponse,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        status: error.statusCode,
        message: error.message,
      });
    }

    return res.status(500).json({
      status: 500,
      message: 'AI 추천 처리 중 서버 오류가 발생했습니다.',
    });
  }
};

module.exports = {
  getAiHealth,
  postAiChat,
  postAiImageGenerate,
  getAiRecommend,
};
