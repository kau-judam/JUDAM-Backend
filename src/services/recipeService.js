const { checkRecipeLegalFilter } = require('../utils/aiFilterInterface');
const pool = require('../db');

const INTEREST_THRESHOLD = 100;

// 레시피 작성 (POST /api/recipes)
const createRecipe = async (recipeData, user) => {
  const { passed, reason } = await checkRecipeLegalFilter(recipeData);
  if (!passed) {
    const error = new Error(reason || '등록할 수 없는 내용이 포함되어 있습니다. 레시피 내용을 다시 확인해 주세요.');
    error.statusCode = 400;
    throw error;
  }

  const author_type = user.role === 'BREWERY' ? 'BREWERY' : 'CONSUMER';

  const result = await pool.query(
    `INSERT INTO recipes
       (user_id, title, content, abv_range, main_ingredient, target_flavor, concept, summary, image_url, author_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING recipe_id, title, author_type, status, is_fundable, interest_count, image_url, created_at`,
    [
      user.id,
      recipeData.title,
      recipeData.content,
      recipeData.abv_range,
      recipeData.main_ingredient,
      recipeData.target_flavor,
      recipeData.concept,
      recipeData.summary,
      recipeData.image_url || null,
      author_type,
    ]
  );

  return result.rows[0];
};

// 레시피 목록 조회 (GET /api/recipes)
const getRecipes = async (sort, status, page, size) => {
  const offset = page * size;
  const orderClause = sort === 'popular' ? 'ORDER BY interest_count DESC' : 'ORDER BY created_at DESC';

  let dataQuery, countQuery, dataParams, countParams;

  if (status && status !== 'ALL') {
    dataQuery = `
      SELECT recipe_id, title, summary, main_ingredient, author_type, status, is_fundable, interest_count, image_url, created_at
      FROM recipes
      WHERE status = $1
      ${orderClause}
      LIMIT $2 OFFSET $3
    `;
    dataParams = [status, size, offset];
    countQuery = 'SELECT COUNT(*) FROM recipes WHERE status = $1';
    countParams = [status];
  } else {
    dataQuery = `
      SELECT recipe_id, title, summary, main_ingredient, author_type, status, is_fundable, interest_count, image_url, created_at
      FROM recipes
      ${orderClause}
      LIMIT $1 OFFSET $2
    `;
    dataParams = [size, offset];
    countQuery = 'SELECT COUNT(*) FROM recipes';
    countParams = [];
  }

  const [dataResult, countResult] = await Promise.all([
    pool.query(dataQuery, dataParams),
    pool.query(countQuery, countParams),
  ]);

  const totalElements = parseInt(countResult.rows[0].count, 10);
  const totalPages = Math.ceil(totalElements / size) || 1;

  return { recipes: dataResult.rows, totalElements, totalPages, currentPage: page };
};

// 레시피 상세 조회 (GET /api/recipes/:recipeId)
const getRecipeById = async (recipeId) => {
  const result = await pool.query('SELECT * FROM recipes WHERE recipe_id = $1', [recipeId]);
  return result.rows[0] || null;
};

// 관심 등록 (POST /api/recipes/:recipeId/interests)
const addInterest = async (recipeId, userId) => {
  const recipeResult = await pool.query('SELECT recipe_id FROM recipes WHERE recipe_id = $1', [recipeId]);
  if (recipeResult.rows.length === 0) {
    const error = new Error('해당 레시피를 찾을 수 없습니다.');
    error.statusCode = 404;
    throw error;
  }

  const existing = await pool.query(
    'SELECT interest_id FROM recipe_interests WHERE recipe_id = $1 AND user_id = $2',
    [recipeId, userId]
  );
  if (existing.rows.length > 0) {
    const error = new Error('이미 관심 등록한 레시피입니다.');
    error.statusCode = 400;
    throw error;
  }

  await pool.query(
    'INSERT INTO recipe_interests (recipe_id, user_id) VALUES ($1, $2)',
    [recipeId, userId]
  );

  const updated = await pool.query(
    `UPDATE recipes
     SET interest_count = interest_count + 1,
         is_fundable = CASE WHEN interest_count + 1 >= $1 THEN true ELSE is_fundable END,
         status = CASE WHEN interest_count + 1 >= $1 THEN 'FUNDING_READY' ELSE status END
     WHERE recipe_id = $2
     RETURNING recipe_id, interest_count, is_fundable`,
    [INTEREST_THRESHOLD, recipeId]
  );

  return updated.rows[0];
};

// 관심 해제 (DELETE /api/recipes/:recipeId/interests)
// 운영 정책: is_fundable이 이미 true면 해제해도 되돌리지 않음
const removeInterest = async (recipeId, userId) => {
  const recipeResult = await pool.query('SELECT recipe_id FROM recipes WHERE recipe_id = $1', [recipeId]);
  if (recipeResult.rows.length === 0) {
    const error = new Error('해당 레시피를 찾을 수 없습니다.');
    error.statusCode = 404;
    throw error;
  }

  const deleteResult = await pool.query(
    'DELETE FROM recipe_interests WHERE recipe_id = $1 AND user_id = $2 RETURNING interest_id',
    [recipeId, userId]
  );
  if (deleteResult.rows.length === 0) {
    const error = new Error('관심 등록 내역이 없습니다.');
    error.statusCode = 400;
    throw error;
  }

  const updated = await pool.query(
    `UPDATE recipes
     SET interest_count = GREATEST(interest_count - 1, 0)
     WHERE recipe_id = $1
     RETURNING recipe_id, interest_count, is_fundable`,
    [recipeId]
  );

  return updated.rows[0];
};

module.exports = { createRecipe, getRecipes, getRecipeById, addInterest, removeInterest };
