const {
  suggestSubIngredients,
  suggestFlavorTags,
  suggestSummary,
} = require('../services/aiRecipe.service');

const suggestSubIngredientsController = async (req, res) => {
  try {
    const { main_ingredient, region } = req.body;

    if (!main_ingredient || !region) {
      return res.status(400).json({
        status: 400,
        message: 'main_ingredient와 region은 필수입니다.',
      });
    }

    const data = await suggestSubIngredients({
      main_ingredient,
      region,
    });

    return res.status(200).json({
      status: 200,
      message: '서브재료 추천 성공',
      data,
    });
  } catch (error) {
    console.error('[AI Recipe] 서브재료 추천 실패:', error);

    return res.status(error.status || 500).json({
      status: error.status || 500,
      message: error.message || '서브재료 추천 중 서버 오류가 발생했습니다.',
    });
  }
};

const suggestFlavorTagsController = async (req, res) => {
  try {
    const { title, main_ingredient, sub_ingredients, abv_range } = req.body;

    if (!title || !main_ingredient || !abv_range) {
      return res.status(400).json({
        status: 400,
        message: 'title, main_ingredient, abv_range는 필수입니다.',
      });
    }

    const data = await suggestFlavorTags({
      title,
      main_ingredient,
      sub_ingredients,
      abv_range,
    });

    return res.status(200).json({
      status: 200,
      message: '맛 태그 추천 성공',
      data,
    });
  } catch (error) {
    console.error('[AI Recipe] 맛 태그 추천 실패:', error);

    return res.status(error.status || 500).json({
      status: error.status || 500,
      message: error.message || '맛 태그 추천 중 서버 오류가 발생했습니다.',
    });
  }
};

const suggestSummaryController = async (req, res) => {
  try {
    const {
      title,
      main_ingredient,
      sub_ingredients,
      abv_range,
      flavor_tags,
      concept,
    } = req.body;

    if (!title || !main_ingredient || !abv_range) {
      return res.status(400).json({
        status: 400,
        message: 'title, main_ingredient, abv_range는 필수입니다.',
      });
    }

    const data = await suggestSummary({
      title,
      main_ingredient,
      sub_ingredients,
      abv_range,
      flavor_tags,
      concept,
    });

    return res.status(200).json({
      status: 200,
      message: '요약문 추천 성공',
      data,
    });
  } catch (error) {
    console.error('[AI Recipe] 요약문 추천 실패:', error);

    return res.status(error.status || 500).json({
      status: error.status || 500,
      message: error.message || '요약문 추천 중 서버 오류가 발생했습니다.',
    });
  }
};

module.exports = {
  suggestSubIngredientsController,
  suggestFlavorTagsController,
  suggestSummaryController,
};
