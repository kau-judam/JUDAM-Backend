const { getMyRecipes, getMyInterestRecipes, getMyRecipeComments } = require('../services/mypageService');

// 내가 작성한 레시피 목록 (GET /api/users/me/recipes)
const getMyRecipeList = async (req, res) => {
  const userId = req.user.id;
  const page = Math.max(0, parseInt(req.query.page, 10) || 0);
  const size = Math.max(1, parseInt(req.query.size, 10) || 20);

  try {
    const result = await getMyRecipes(userId, page, size);
    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 내가 관심 등록한 레시피 목록 (GET /api/users/me/interests/recipes)
const getMyInterestRecipeList = async (req, res) => {
  const userId = req.user.id;
  const page = Math.max(0, parseInt(req.query.page, 10) || 0);
  const size = Math.max(1, parseInt(req.query.size, 10) || 20);

  try {
    const result = await getMyInterestRecipes(userId, page, size);
    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 내가 작성한 레시피 댓글 목록 (GET /api/users/me/recipe-comments)
const getMyRecipeCommentList = async (req, res) => {
  const userId = req.user.id;
  const page = Math.max(0, parseInt(req.query.page, 10) || 0);
  const size = Math.max(1, parseInt(req.query.size, 10) || 20);

  try {
    const result = await getMyRecipeComments(userId, page, size);
    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

module.exports = { getMyRecipeList, getMyInterestRecipeList, getMyRecipeCommentList };
