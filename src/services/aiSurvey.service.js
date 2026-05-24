const convertSurvey = async (surveyResponses, userId) => {
  const AI_SERVER_BASE_URL = process.env.AI_SERVER_BASE_URL;

  if (!AI_SERVER_BASE_URL) {
    const error = new Error('AI_SERVER_BASE_URL 환경변수가 설정되어 있지 않습니다.');
    error.status = 500;
    throw error;
  }

  const baseUrl = AI_SERVER_BASE_URL.replace(/\/+$/, '');
  const query = userId !== undefined && userId !== null
    ? `?user_id=${encodeURIComponent(String(userId))}`
    : '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${baseUrl}/api/survey/convert${query}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify(surveyResponses),
    });

    let data = null;

    try {
      data = await response.json();
    } catch (jsonError) {
      const error = new Error('AI 서버 응답을 해석할 수 없습니다.');
      error.status = 502;
      throw error;
    }

    if (!response.ok) {
      if (response.status === 422) {
        const error = new Error('술BTI 설문 답변 형식이 올바르지 않습니다.');
        error.status = 400;
        error.data = data;
        throw error;
      }

      const error = new Error(data?.message || data?.detail || 'AI 서버 요청에 실패했습니다.');
      error.status = response.status || 502;
      error.data = data;
      throw error;
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('AI 서버 응답 시간이 초과되었습니다.');
      timeoutError.status = 504;
      throw timeoutError;
    }

    if (error.status) {
      throw error;
    }

    const connectionError = new Error('AI 서버와 연결할 수 없습니다.');
    connectionError.status = 502;
    throw connectionError;
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = {
  convertSurvey,
};
