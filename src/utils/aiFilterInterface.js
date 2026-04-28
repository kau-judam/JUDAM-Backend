/**
 * AI 법률 필터링 연동 인터페이스 (기능 6-9)
 * 8주차: 메서드 시그니처만 정의, 실제 AI 호출 없이 항상 통과 처리
 * 실제 AI 연동 시 이 메서드의 내부만 교체
 */

/**
 * @param {Object} recipeData - 레시피 요청 바디
 * @param {string} recipeData.title
 * @param {string} recipeData.content
 * @param {string} recipeData.main_ingredient
 * @returns {Promise<{ passed: boolean, reason: string | null }>}
 */
const checkRecipeLegalFilter = async (recipeData) => {
  return { passed: true, reason: null };
};

module.exports = { checkRecipeLegalFilter };
