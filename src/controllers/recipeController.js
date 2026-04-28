const { createRecipe } = require('../services/recipeService');

const REQUIRED_FIELDS = ['title', 'content', 'abv_range', 'main_ingredient', 'target_flavor', 'concept', 'summary'];

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

module.exports = { postRecipe };
