const multer = require('multer');
const { uploadFileToS3 } = require('../services/s3.service');
const { createRecipe, getRecipes, getRecipeById, addInterest, removeInterest, createBreweryRecipe, getConsumerRecipes, convertRecipeToFunding, deleteRecipe } = require('../services/recipeService');

const upload = multer({ storage: multer.memoryStorage() });

// 레시피 작성 시 반드시 있어야 하는 필드 목록
// 하나라도 빠지면 400 에러 반환
const REQUIRED_FIELDS = ['title', 'content', 'abv_range', 'main_ingredient', 'target_flavor', 'concept', 'summary'];

// 레시피 목록 조회 시 status 쿼리 파라미터로 허용되는 값
// 이 목록에 없는 값이 오면 'ALL'(전체)로 처리
const VALID_STATUSES = new Set(['ALL', 'PUBLISHED', 'FUNDING_READY', 'FUNDING_IN_PROGRESS', 'COMPLETED']);

// 레시피 작성 핸들러 (POST /api/recipes)
// - 로그인 필수 (authMiddleware에서 JWT 검증 후 req.user에 사용자 정보 주입)
// - 이미지 파일(req.file)이 있으면 S3에 업로드 후 URL을 recipeData에 주입
const postRecipe = async (req, res) => {
const body = req.body || {};
  const missing = REQUIRED_FIELDS.filter((f) => !body[f]);
  if (missing.length > 0) {
    return res.status(400).json({
      status: 400,
      message: '필수 항목이 누락되었습니다.',
    });
  }

  try {
    let imageUrl = null;
    if (req.file) {
      imageUrl = await uploadFileToS3(req.file.buffer, req.file.originalname, req.file.mimetype, req.user.id);
    }

    const recipeData = { ...body, image_url: imageUrl };
    const recipe = await createRecipe(recipeData, req.user);
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
// - 로그인 선택 (optionalAuthMiddleware — 로그인 시 is_interested 반영)
const getRecipeList = async (req, res) => {
  const sort = req.query.sort === 'popular' ? 'popular' : 'newest';
  const status = req.query.status && VALID_STATUSES.has(req.query.status) ? req.query.status : 'ALL';
  const page = Math.max(0, parseInt(req.query.page, 10) || 0);
  const size = Math.max(1, parseInt(req.query.size, 10) || 20);
  const userId = req.user?.id || null;

  try {
    const result = await getRecipes(sort, status, page, size, userId);
    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 레시피 상세 조회 핸들러 (GET /api/recipes/:recipeId)
// - 로그인 선택 (optionalAuthMiddleware — 로그인 시 is_interested 반영)
const getRecipeDetail = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);
  const userId = req.user?.id || null;

  try {
    const recipe = await getRecipeById(recipeId, userId);
    if (!recipe) {
      return res.status(404).json({ status: 404, message: '해당 레시피를 찾을 수 없습니다.' });
    }
    return res.status(200).json({ recipe });
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 관심 등록 핸들러 (POST /api/recipes/:recipeId/interests)
const postInterest = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);
  const userId = req.user.id;

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
const deleteInterest = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);
  const userId = req.user.id;

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

// 양조장 레시피 등록 핸들러 (POST /api/recipes/brewery)
const postBreweryRecipe = async (req, res) => {
  const missing = REQUIRED_FIELDS.filter((f) => !req.body[f]);
  if (missing.length > 0) {
    return res.status(400).json({ status: 400, message: '필수 항목이 누락되었습니다.' });
  }

  try {
    const recipe = await createBreweryRecipe(req.body, req.user);
    return res.status(201).json({ status: 201, message: '레시피가 등록되었습니다.', recipe });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ status: 400, message: error.message });
    }
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 양조장 소비자 레시피 확인 핸들러 (GET /api/recipes/brewery)
const getBreweryRecipes = async (req, res) => {
  const status = req.query.status || 'ALL';
  const page = Math.max(0, parseInt(req.query.page, 10) || 0);
  const size = Math.max(1, parseInt(req.query.size, 10) || 20);

  try {
    const result = await getConsumerRecipes(status, page, size);
    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 양조장 펀딩 전환 핸들러 (POST /api/recipes/:recipeId/funding)
const FUNDING_REQUIRED_FIELDS = ['title', 'description', 'goal_amount', 'start_date', 'end_date'];

const postRecipeFunding = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);
  const missing = FUNDING_REQUIRED_FIELDS.filter((f) => req.body[f] === undefined || req.body[f] === null || req.body[f] === '');
  if (missing.length > 0) {
    return res.status(400).json({ status: 400, message: '필수 항목이 누락되었습니다.' });
  }

  try {
    const funding = await convertRecipeToFunding(recipeId, req.user.id, req.body);
    return res.status(201).json({
      status: 201,
      message: '펀딩 프로젝트가 등록되었습니다.',
      funding,
    });
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

// 레시피 삭제 핸들러 (DELETE /api/recipes/:recipeId)
const deleteRecipeHandler = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);
  try {
    await deleteRecipe(recipeId, req.user.id);
    return res.status(200).json({ status: 200, message: '레시피가 삭제되었습니다.' });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ status: 400, message: error.message });
    }
    if (error.statusCode === 403) {
      return res.status(403).json({ status: 403, message: error.message });
    }
    if (error.statusCode === 404) {
      return res.status(404).json({ status: 404, message: error.message });
    }
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

module.exports = { upload, postRecipe, getRecipeList, getRecipeDetail, postInterest, deleteInterest, postBreweryRecipe, getBreweryRecipes, postRecipeFunding, deleteRecipeHandler };
