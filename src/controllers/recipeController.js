const { createRecipe, getRecipes, getRecipeById, addInterest, removeInterest } = require('../services/recipeService');

// 레시피 작성 시 반드시 있어야 하는 필드 목록
// 하나라도 빠지면 400 에러 반환
const REQUIRED_FIELDS = ['title', 'content', 'abv_range', 'main_ingredient', 'target_flavor', 'concept', 'summary'];

// 레시피 목록 조회 시 status 쿼리 파라미터로 허용되는 값
// 이 목록에 없는 값이 오면 'ALL'(전체)로 처리
const VALID_STATUSES = new Set(['ALL', 'PUBLISHED', 'FUNDING_READY', 'FUNDING_IN_PROGRESS', 'COMPLETED']);

// 레시피 작성 핸들러 (POST /api/recipes)
// - 로그인 필수 (authMiddleware에서 JWT 검증 후 req.user에 사용자 정보 주입)
// - AI 법률 필터 통과 여부는 서비스에서 처리
const postRecipe = async (req, res) => {
  // 필수 필드 누락 여부 확인
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

// 레시피 목록 조회 핸들러 (GET /api/recipes)
// - 로그인 불필요 (누구나 접근 가능)
// - 쿼리 파라미터: sort(정렬), status(필터), page(페이지 번호), size(한 페이지 항목 수)
const getRecipeList = async (req, res) => {
  const sort = req.query.sort === 'popular' ? 'popular' : 'newest';
  const status = req.query.status && VALID_STATUSES.has(req.query.status) ? req.query.status : 'ALL';
  const page = Math.max(0, parseInt(req.query.page, 10) || 0);   // 0 미만 방지
  const size = Math.max(1, parseInt(req.query.size, 10) || 20);  // 1 미만 방지, 기본 20개

  try {
    const result = await getRecipes(sort, status, page, size);
    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 레시피 상세 조회 핸들러 (GET /api/recipes/:recipeId)
// - 로그인 불필요
// - 존재하지 않는 recipeId 요청 시 404 반환
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

// 관심 등록 핸들러 (POST /api/recipes/:recipeId/interests)
// - 로그인 필수 (req.user.id로 현재 사용자 식별)
// - 중복 등록, 레시피 없음은 서비스에서 에러로 던져주고 여기서 상태코드별로 응답
const postInterest = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);
  const userId = req.user.id; // JWT 토큰에서 추출한 현재 로그인 사용자 ID

  try {
    const data = await addInterest(recipeId, userId);
    return res.status(200).json({ status: 200, message: '관심 등록 완료', data });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ status: 400, message: error.message });
    }
    if (error.statusCode === 404) {
      return res.status(404).json({ status: 404, message: error.message });
    }
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 관심 해제 핸들러 (DELETE /api/recipes/:recipeId/interests)
// - 로그인 필수 (req.user.id로 현재 사용자 식별)
// - 등록 내역 없음, 레시피 없음은 서비스에서 에러로 던져주고 여기서 상태코드별로 응답
const deleteInterest = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);
  const userId = req.user.id; // JWT 토큰에서 추출한 현재 로그인 사용자 ID

  try {
    const data = await removeInterest(recipeId, userId);
    return res.status(200).json({ status: 200, message: '관심 해제 완료', data });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ status: 400, message: error.message });
    }
    if (error.statusCode === 404) {
      return res.status(404).json({ status: 404, message: error.message });
    }
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

module.exports = { postRecipe, getRecipeList, getRecipeDetail, postInterest, deleteInterest };
