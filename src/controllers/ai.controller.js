const {
  checkAiServerHealth,
  requestAiChat,
  requestAiChatStream,
  requestAiRecommend,
  generateAiImageAndUpload,
  requestNewDrink,
  approveNewDrinkRequest,
} = require('../services/ai.service');
const { findUserTasteVectorById } = require('../services/user.service');

const ALLOWED_RECOMMEND_POOLS = new Set(['all', 'base', 'funding', 'recipe']);

const sendAiControllerError = (res, error, fallbackMessage) => {
  if (error.statusCode) {
    return res.status(error.statusCode).json({
      status: error.statusCode,
      message: error.message,
    });
  }

  return res.status(500).json({
    status: 500,
    message: fallbackMessage,
  });
};

const isStreamCanceled = (error) => error?.code === 'ERR_CANCELED'
  || error?.name === 'CanceledError'
  || error?.message === 'canceled';

const writeSseErrorEvent = (res, status, message) => {
  if (res.writableEnded || res.destroyed) {
    return;
  }

  res.write(`event: error\ndata: ${JSON.stringify({ status, message })}\n\n`);
};

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

const postAiChatStream = async (req, res) => {
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

  const abortController = new AbortController();
  let streamFinished = false;
  let clientClosed = false;
  let aiStream = null;

  res.on('close', () => {
    if (!streamFinished) {
      clientClosed = true;
      abortController.abort();
      if (aiStream && typeof aiStream.destroy === 'function') {
        aiStream.destroy();
      }
    }
  });

  try {
    const aiStreamResponse = await requestAiChatStream({
      message,
      userId,
      history,
      signal: abortController.signal,
    });
    aiStream = aiStreamResponse.data;

    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    aiStream.on('error', () => {
      if (clientClosed) {
        return;
      }

      writeSseErrorEvent(res, 502, 'AI 서버와 연결할 수 없습니다.');
      streamFinished = true;
      if (!res.writableEnded && !res.destroyed) {
        res.end();
      }
    });

    aiStream.on('end', () => {
      streamFinished = true;
      if (!res.writableEnded) {
        res.end();
      }
    });

    aiStream.pipe(res, { end: false });
  } catch (error) {
    if (clientClosed || isStreamCanceled(error)) {
      return;
    }

    const statusCode = error.statusCode || 500;
    const messageText = error.statusCode
      ? error.message
      : 'AI 챗봇 스트리밍 처리 중 서버 오류가 발생했습니다.';

    if (res.headersSent) {
      writeSseErrorEvent(res, statusCode, messageText);
      streamFinished = true;
      return res.end();
    }

    return res.status(statusCode).json({
      status: statusCode,
      message: messageText,
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

const postAiDrinkRequest = async (req, res) => {
  const userId = req.user?.userId;
  const name = typeof req.body?.name === 'string'
    ? req.body.name.trim()
    : '';

  if (!userId) {
    return res.status(401).json({
      status: 401,
      message: '유효하지 않거나 만료된 토큰입니다.',
    });
  }

  if (!name) {
    return res.status(400).json({
      status: 400,
      message: '전통주 이름을 입력해주세요.',
    });
  }

  try {
    const aiResponse = await requestNewDrink({
      user_id: String(userId),
      name,
      brewery: req.body?.brewery || null,
      region: req.body?.region || null,
      description: req.body?.description || null,
    });

    return res.status(200).json({
      status: 200,
      message: '신규 전통주 등록 요청 성공',
      data: aiResponse,
    });
  } catch (error) {
    return sendAiControllerError(
      res,
      error,
      '신규 전통주 등록 요청 중 서버 오류가 발생했습니다.',
    );
  }
};

const postAiDrinkRequestApprove = async (req, res) => {
  const requestId = req.params?.requestId;

  if (!requestId || !/^\d+$/.test(String(requestId))) {
    return res.status(400).json({
      status: 400,
      message: '전통주 등록 요청 ID가 올바르지 않습니다.',
    });
  }

  try {
    const aiResponse = await approveNewDrinkRequest(requestId);

    return res.status(200).json({
      status: 200,
      message: '신규 전통주 등록 요청 승인 성공',
      data: aiResponse,
    });
  } catch (error) {
    return sendAiControllerError(
      res,
      error,
      '신규 전통주 등록 요청 승인 중 서버 오류가 발생했습니다.',
    );
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
  postAiChatStream,
  postAiImageGenerate,
  postAiDrinkRequest,
  postAiDrinkRequestApprove,
  getAiRecommend,
};
