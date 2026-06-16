const {
  getPublicStatsSummary,
} = require('../services/stats.service');

const getStatsSummary = async (req, res) => {
  try {
    const data = await getPublicStatsSummary();

    return res.status(200).json({
      status: 200,
      message: '통계 조회 성공',
      data,
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '통계 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

module.exports = {
  getStatsSummary,
};
