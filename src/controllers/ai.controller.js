const { checkAiServerHealth } = require('../services/ai.service');

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

module.exports = { getAiHealth };
