const pool = require('../db');

// 내가 작성한 레시피 목록 (GET /api/users/me/recipes)
const getMyRecipes = async (userId, page, size) => {
  const offset = page * size;

  const [dataResult, countResult] = await Promise.all([
    pool.query(
      `SELECT recipe_id, title, summary, main_ingredient, status, is_fundable, interest_count, image_url, created_at
       FROM recipes
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, size, offset]
    ),
    pool.query('SELECT COUNT(*) FROM recipes WHERE user_id = $1', [userId]),
  ]);

  const totalElements = parseInt(countResult.rows[0].count, 10);
  const totalPages = Math.ceil(totalElements / size) || 1;

  return { recipes: dataResult.rows, totalElements, totalPages, currentPage: page };
};

// 내가 관심 등록한 레시피 목록 (GET /api/users/me/interests/recipes)
const getMyInterestRecipes = async (userId, page, size) => {
  const offset = page * size;

  const [dataResult, countResult] = await Promise.all([
    pool.query(
      `SELECT r.recipe_id, r.title, r.summary, r.main_ingredient, r.author_type,
              r.status, r.is_fundable, r.interest_count, r.image_url,
              ri.created_at AS interested_at
       FROM recipe_interests ri
       JOIN recipes r ON r.recipe_id = ri.recipe_id
       WHERE ri.user_id = $1
       ORDER BY ri.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, size, offset]
    ),
    pool.query('SELECT COUNT(*) FROM recipe_interests WHERE user_id = $1', [userId]),
  ]);

  const totalElements = parseInt(countResult.rows[0].count, 10);
  const totalPages = Math.ceil(totalElements / size) || 1;

  return { recipes: dataResult.rows, totalElements, totalPages, currentPage: page };
};

// 내가 작성한 레시피 댓글 목록 (GET /api/users/me/recipe-comments)
const getMyRecipeComments = async (userId, page, size) => {
  const offset = page * size;

  const [dataResult, countResult] = await Promise.all([
    pool.query(
      `SELECT rc.comment_id, rc.content, rc.like_count, rc.created_at, rc.updated_at,
              json_build_object('recipe_id', r.recipe_id, 'title', r.title, 'status', r.status) AS recipe
       FROM recipe_comments rc
       JOIN recipes r ON r.recipe_id = rc.recipe_id
       WHERE rc.user_id = $1
       ORDER BY rc.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, size, offset]
    ),
    pool.query('SELECT COUNT(*) FROM recipe_comments WHERE user_id = $1', [userId]),
  ]);

  const totalElements = parseInt(countResult.rows[0].count, 10);
  const totalPages = Math.ceil(totalElements / size) || 1;

  return { comments: dataResult.rows, totalElements, totalPages, currentPage: page };
};

module.exports = { getMyRecipes, getMyInterestRecipes, getMyRecipeComments };
