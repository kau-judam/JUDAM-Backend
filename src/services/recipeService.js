const { checkRecipeLegalFilter } = require('../utils/aiFilterInterface');

const createRecipe = async (recipeData, user) => {
  const { passed, reason } = await checkRecipeLegalFilter(recipeData);
  if (!passed) {
    const error = new Error(reason || '등록할 수 없는 내용이 포함되어 있습니다. 레시피 내용을 다시 확인해 주세요.');
    error.statusCode = 400;
    throw error;
  }

  const author_type = user.role === 'BREWERY' ? 'BREWERY' : 'CONSUMER';

  const recipe = {
    recipe_id: 1,
    title: recipeData.title,
    author_type,
    status: 'PUBLISHED',
    is_fundable: false,
    interest_count: 0,
    image_url: recipeData.image_url || null,
    created_at: new Date().toISOString(),
  };

  return recipe;
};

module.exports = { createRecipe };
