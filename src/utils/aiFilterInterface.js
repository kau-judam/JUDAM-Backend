/**
 * AI 법률 필터링 연동 인터페이스
 * AI 서버(POST /api/law/filter)를 호출해 레시피 내용의 법적 위반 여부를 검사한다.
 * AI 서버가 다운된 경우 경고 로그만 남기고 통과 처리한다.
 */

const AI_SERVER_URL = process.env.AI_SERVER_URL || 'http://localhost:8000';
const AI_FILTER_TIMEOUT_MS = 5000;

/**
 * @param {Object} recipeData - 레시피 요청 바디
 * @param {string} recipeData.title
 * @param {string} recipeData.content
 * @param {string} recipeData.main_ingredient
 * @returns {Promise<{ passed: boolean, reason: string | null }>}
 */
const checkRecipeLegalFilter = async (recipeData) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_FILTER_TIMEOUT_MS);

    const response = await fetch(`${AI_SERVER_URL}/api/law/filter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content_type: 'recipe',
        title: recipeData.title || '',
        description: recipeData.content || '',
        ingredients: recipeData.main_ingredient ? [recipeData.main_ingredient] : [],
        target_region: '서울',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[AI Filter] 서버 오류 (${response.status}), 통과 처리`);
      return { passed: true, reason: null };
    }

    const result = await response.json();

    if (result.violation) {
      return {
        passed: false,
        reason: result.recommendation || '등록할 수 없는 내용이 포함되어 있습니다. 레시피 내용을 다시 확인해 주세요.',
      };
    }

    return { passed: true, reason: null };
  } catch (err) {
    // 타임아웃 또는 AI 서버 다운 시 통과 처리 (서비스 중단 방지)
    console.warn(`[AI Filter] 연결 실패 (${err.message}), 통과 처리`);
    return { passed: true, reason: null };
  }
};

module.exports = { checkRecipeLegalFilter };
