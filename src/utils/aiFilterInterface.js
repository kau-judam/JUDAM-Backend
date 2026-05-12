/**
 * AI 법률 필터링 연동 인터페이스
 * AI 서버(POST /api/law/filter)를 호출해 레시피 내용의 법적 위반 여부를 검사한다.
 * AI 서버 다운·타임아웃·오류 등 어떤 이유로든 통과 응답을 받지 못하면 등록을 차단한다.
 */

const AI_SERVER_URL =
  process.env.AI_SERVER_BASE_URL ||
  process.env.AI_SERVER_URL ||
  'http://localhost:8000';
const AI_FILTER_TIMEOUT_MS = 5000;
const DEFAULT_RECIPE_TITLE = 'recipe';

/**
 * @param {Object} recipeData - 레시피 요청 바디
 * @param {string} recipeData.title
 * @param {string} recipeData.content
 * @param {string} recipeData.abv_range
 * @param {string} recipeData.main_ingredient
 * @param {string} recipeData.target_flavor
 * @param {string} recipeData.concept
 * @param {string} recipeData.summary
 * @returns {Promise<{ passed: boolean, reason: string | null }>}
 */
const buildRecipeDescription = (recipeData = {}) => {
  const fields = [
    ['content', recipeData.content],
    ['abv_range', recipeData.abv_range],
    ['main_ingredient', recipeData.main_ingredient],
    ['target_flavor', recipeData.target_flavor],
    ['concept', recipeData.concept],
    ['summary', recipeData.summary],
  ];

  return fields
    .map(([label, value]) => `${label}: ${value === undefined || value === null ? '' : String(value)}`)
    .join('\n');
};

const buildViolationReason = (result) => {
  if (result.recommendation) {
    return result.recommendation;
  }

  if (Array.isArray(result.details) && result.details.length > 0) {
    return result.details
      .map((detail) => (typeof detail === 'string' ? detail : JSON.stringify(detail)))
      .join('\n');
  }

  return 'Recipe content cannot be registered. Please check the recipe content.';
};

const checkRecipeLegalFilter = async (recipeData) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_FILTER_TIMEOUT_MS);

    const response = await fetch(`${AI_SERVER_URL}/api/law/filter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: recipeData?.title || DEFAULT_RECIPE_TITLE,
        content_type: 'recipe',
        description: buildRecipeDescription(recipeData),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[AI Filter] 서버 오류 (${response.status})`);
      return { passed: false, reason: 'AI 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' };
    }

    const result = await response.json();

    if (result.violation) {
      return {
        passed: false,
        reason: buildViolationReason(result),
      };
    }

    return { passed: true, reason: null };
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('[AI Filter] 요청 시간 초과');
      return { passed: false, reason: 'AI 서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.' };
    }
    console.error(`[AI Filter] 연결 실패 (${err.message})`);
    return { passed: false, reason: 'AI 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.' };
  }
};

module.exports = { checkRecipeLegalFilter };
