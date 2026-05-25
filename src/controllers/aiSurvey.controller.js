const { convertAndSaveMySulbtiSurvey } = require('../services/mypage.service');

const getErrorStatus = (error) => error.statusCode || error.status || 500;

const convertSurveyController = async (req, res) => {
  const tokenUserId = req.user?.userId;
  const queryUserId = req.query?.user_id;

  if (!tokenUserId) {
    return res.status(401).json({
      status: 401,
      message: '유효하지 않거나 만료된 토큰입니다.',
    });
  }

  if (
    queryUserId !== undefined
    && queryUserId !== null
    && String(queryUserId) !== String(tokenUserId)
  ) {
    return res.status(403).json({
      status: 403,
      message: '요청한 사용자와 로그인 사용자가 일치하지 않습니다.',
    });
  }

  try {
    const data = await convertAndSaveMySulbtiSurvey(tokenUserId, req.body);

    return res.status(200).json({
      status: 200,
      message: '술BTI 결과 저장 성공',
      data,
    });
  } catch (error) {
    const status = getErrorStatus(error);

    if (status >= 400 && status < 600) {
      return res.status(status).json({
        status,
        message: error.message,
      });
    }

    return res.status(500).json({
      status: 500,
      message: '술BTI 결과 저장 중 서버 오류가 발생했습니다.',
    });
  }
};

module.exports = {
  convertSurveyController,
};
