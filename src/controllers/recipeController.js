const { createRecipe, getRecipes, getRecipeById } = require('../services/recipeService');

const REQUIRED_FIELDS = ['title', 'content', 'abv_range', 'main_ingredient', 'target_flavor', 'concept', 'summary'];

const VALID_STATUSES = new Set(['ALL', 'PUBLISHED', 'FUNDING_READY', 'FUNDING_IN_PROGRESS', 'COMPLETED']);

const postRecipe = async (req, res) => {
  const missing = REQUIRED_FIELDS.filter((f) => !req.body[f]);
  if (missing.length > 0) {
    return res.status(400).json({
      status: 400,
      message: '필수 항목이 누락되었습니다.',
    });
  }

  try {
    const recipe = await createRecipe(req.body, req.user);
    return res.status(201).json({
      status: 201,
      message: '레시피가 등록되었습니다.',
      recipe,
    });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ status: 400, message: error.message });
    }
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

const getRecipeList = async (req, res) => {
  const sort = req.query.sort === 'popular' ? 'popular' : 'newest';
  const status = req.query.status && VALID_STATUSES.has(req.query.status) ? req.query.status : 'ALL';
  const page = Math.max(0, parseInt(req.query.page, 10) || 0);
  const size = Math.max(1, parseInt(req.query.size, 10) || 20);

  try {
    const result = await getRecipes(sort, status, page, size);
    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

const getRecipeDetail = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);

  try {
    const recipe = await getRecipeById(recipeId);
    if (!recipe) {
      return res.status(404).json({ status: 404, message: '해당 레시피를 찾을 수 없습니다.' });
    }
    return res.status(200).json({ recipe });
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

module.exports = { postRecipe, getRecipeList, getRecipeDetail };
