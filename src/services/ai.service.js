const axios = require('axios');

const checkAiServerHealth = async () => {
  const { AI_SERVER_BASE_URL } = process.env;

  if (!AI_SERVER_BASE_URL) {
    const error = new Error('AI_SERVER_BASE_URL environment variable is missing');
    error.statusCode = 500;
    throw error;
  }

  const baseUrl = AI_SERVER_BASE_URL.replace(/\/+$/, '');
  const response = await axios.get(`${baseUrl}/health`);

  return response.data;
};

module.exports = { checkAiServerHealth };
