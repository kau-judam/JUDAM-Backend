const { convertSurvey } = require('../services/aiSurvey.service');

const REQUIRED_QUESTION_KEYS = Array.from({ length: 25 }, (_, index) => `q${index + 1}`);

const convertSurveyController = async (req, res) => {
  try {
    const surveyResponses = req.body;
    const { user_id: userId } = req.query;

    if (
      !surveyResponses
      || typeof surveyResponses !== 'object'
      || Array.isArray(surveyResponses)
    ) {
      return res.status(400).json({
        status: 400,
        message: '설문 응답 객체가 필요합니다.',
      });
    }

    const missingKeys = REQUIRED_QUESTION_KEYS.filter(
      (key) => !Object.prototype.hasOwnProperty.call(surveyResponses, key),
    );

    if (missingKeys.length > 0) {
      return res.status(400).json({
        status: 400,
        message: `필수 설문 응답이 누락되었습니다: ${missingKeys.join(', ')}`,
      });
    }

    if (!Array.isArray(surveyResponses.q24) || !Array.isArray(surveyResponses.q25)) {
      return res.status(400).json({
        status: 400,
        message: 'q24와 q25는 배열이어야 합니다.',
      });
    }

    const data = await convertSurvey(surveyResponses, userId);

    return res.status(200).json({
      status: 200,
      message: userId !== undefined
        ? '설문 변환 및 프로필 저장 성공'
        : '설문 변환 성공',
      data,
    });
  } catch (error) {
    console.error('[AI Survey] 설문 변환 실패:', error);

    return res.status(error.status || 500).json({
      status: error.status || 500,
      message: error.message || '설문 변환 중 서버 오류가 발생했습니다.',
    });
  }
};

module.exports = {
  convertSurveyController,
};
