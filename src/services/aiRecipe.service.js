const postToAiServer = async (path, body) => {
  const AI_SERVER_BASE_URL = process.env.AI_SERVER_BASE_URL;

  if (!AI_SERVER_BASE_URL) {
    const error = new Error('AI_SERVER_BASE_URL 환경변수가 설정되어 있지 않습니다.');
    error.status = 500;
    throw error;
  }

  const baseUrl = AI_SERVER_BASE_URL.replace(/\/+$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify(body),
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

const suggestSubIngredients = async ({ main_ingredient, region }) => {
  return postToAiServer('/api/recipe/suggest-sub-ingredients', {
    main_ingredient,
    region,
  });
};

const suggestFlavorTags = async ({
  title,
  main_ingredient,
  sub_ingredients,
  abv_range,
}) => {
  return postToAiServer('/api/recipe/suggest-flavor-tags', {
    title,
    main_ingredient,
    sub_ingredients: sub_ingredients || [],
    abv_range,
  });
};

const suggestSummary = async ({
  title,
  main_ingredient,
  sub_ingredients,
  abv_range,
  flavor_tags,
  concept,
}) => {
  return postToAiServer('/api/recipe/suggest-summary', {
    title,
    main_ingredient,
    sub_ingredients: sub_ingredients || [],
    abv_range,
    flavor_tags: flavor_tags || [],
    concept: concept ?? null,
  });
};

module.exports = {
  suggestSubIngredients,
  suggestFlavorTags,
  suggestSummary,
};
