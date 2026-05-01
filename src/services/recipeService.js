const { checkRecipeLegalFilter } = require('../utils/aiFilterInterface');

// 관심 등록 수가 이 값 이상이 되면 레시피가 자동으로 '펀딩 전환 가능' 상태로 바뀜
// is_fundable = true, status = 'FUNDING_READY' 로 자동 전환
// 나중에 기획이 바뀌면 이 숫자만 수정하면 됨
const INTEREST_THRESHOLD = 100;

// TODO: DB 연결 후 이 배열 전체 삭제하고 실제 쿼리로 교체할 것
// AWS RDS가 연결되면 RECIPES 테이블에서 SELECT 쿼리로 데이터를 가져와야 함
// 현재는 API 동작 확인용 가짜 데이터임
const MOCK_RECIPES = [
  {
    recipe_id: 1,
    title: '달콤한 복숭아 막걸리',
    content: '복숭아 과즙을 활용한 저도수 막걸리. 발효 7일 후 복숭아 원액을 블렌딩합니다.',
    abv_range: '6~8%',
    main_ingredient: '쌀, 복숭아',
    ai_sub_ingredient: null,       // AI팀 연동 후 자동으로 채워질 필드 (현재 null)
    target_flavor: '달콤하고 과일향이 풍부하게',
    concept: '여름에 시원하게 즐기는 과일 막걸리',
    summary: '복숭아향 가득한 달콤한 저도수 막걸리',
    author_type: 'CONSUMER',       // 'CONSUMER': 일반 소비자 작성 / 'BREWERY': 양조장 작성
    status: 'FUNDING_READY',       // 관심 수 100개 초과 → 자동 전환된 상태
    is_fundable: true,             // 양조장이 펀딩으로 전환할 수 있는 상태
    interest_count: 105,
    image_url: null,               // S3 이미지 URL (미연동 시 null)
    created_at: '2026-04-27T10:30:00.000Z',
    updated_at: '2026-04-27T10:30:00.000Z',
  },
  {
    recipe_id: 2,
    title: '한라봉 청주',
    content: '제주 한라봉으로 빚은 향긋한 청주. 저온 발효로 과일향을 살립니다.',
    abv_range: '12~14%',
    main_ingredient: '쌀, 한라봉',
    ai_sub_ingredient: null,
    target_flavor: '상큼하고 향긋하게',
    concept: '제주 특산물을 활용한 프리미엄 청주',
    summary: '제주 한라봉으로 빚은 향긋한 청주',
    author_type: 'BREWERY',
    status: 'PUBLISHED',           // 일반 공개 상태 (펀딩 전환 전)
    is_fundable: false,
    interest_count: 23,
    image_url: null,
    created_at: '2026-04-25T14:00:00.000Z',
    updated_at: '2026-04-25T14:00:00.000Z',
  },
  {
    recipe_id: 3,
    title: '흑임자 소주',
    content: '국산 흑임자를 증류해 고소하고 깊은 향의 소주를 만듭니다.',
    abv_range: '25~30%',
    main_ingredient: '흑임자',
    ai_sub_ingredient: null,
    target_flavor: '고소하고 묵직하게',
    concept: '전통 증류 방식으로 만든 프리미엄 흑임자 소주',
    summary: '흑임자로 빚은 고소한 프리미엄 소주',
    author_type: 'CONSUMER',
    status: 'PUBLISHED',
    is_fundable: false,
    interest_count: 67,
    image_url: null,
    created_at: '2026-04-29T09:00:00.000Z',
    updated_at: '2026-04-29T09:00:00.000Z',
  },
  {
    recipe_id: 4,
    title: '녹차 막걸리',
    content: '제주 녹차 분말을 배합해 쌉싸름한 여운이 남는 막걸리입니다.',
    abv_range: '5~7%',
    main_ingredient: '쌀, 녹차',
    ai_sub_ingredient: null,
    target_flavor: '쌉싸름하고 깔끔하게',
    concept: '건강한 재료로 빚은 저도수 막걸리',
    summary: '녹차 향이 은은한 쌉싸름한 막걸리',
    author_type: 'CONSUMER',
    status: 'PUBLISHED',
    is_fundable: false,
    interest_count: 8,
    image_url: null,
    created_at: '2026-04-29T11:00:00.000Z',
    updated_at: '2026-04-29T11:00:00.000Z',
  },
];

// 레시피 작성 (POST /api/recipes)
// - AI 법률 필터를 통과해야만 등록 가능
// - 작성자 유형(author_type)은 JWT 토큰의 role 값으로 자동 결정 (요청 바디로 받지 않음)
// TODO: DB 연결 후 RECIPES 테이블에 INSERT 쿼리로 교체할 것 (현재 recipe_id가 1로 고정되어 있음)
const createRecipe = async (recipeData, user) => {
  const { passed, reason } = await checkRecipeLegalFilter(recipeData);
  if (!passed) {
    const error = new Error(reason || '등록할 수 없는 내용이 포함되어 있습니다. 레시피 내용을 다시 확인해 주세요.');
    error.statusCode = 400;
    throw error;
  }

  // JWT 토큰의 role이 'BREWERY'면 양조장 작성, 그 외는 일반 소비자 작성으로 처리
  const author_type = user.role === 'BREWERY' ? 'BREWERY' : 'CONSUMER';

  const recipe = {
    recipe_id: 1, // TODO: DB 연결 후 자동 증가 시퀀스(BIGSERIAL)로 교체
    title: recipeData.title,
    author_type,
    status: 'PUBLISHED',   // 작성 직후 기본 상태
    is_fundable: false,    // 관심 수 임계값 초과 전까지는 false
    interest_count: 0,
    image_url: recipeData.image_url || null,
    created_at: new Date().toISOString(),
  };

  return recipe;
};

// 레시피 목록 조회 (GET /api/recipes)
// - sort: 'popular'(관심 수 내림차순) / 'newest'(최신순, 기본값)
// - status: 특정 상태만 필터링. 'ALL'이면 전체 반환
// - page, size: 페이지네이션 (page는 0부터 시작)
// TODO: DB 연결 후 RECIPES 테이블 SELECT + ORDER BY + LIMIT/OFFSET 쿼리로 교체
const getRecipes = async (sort, status, page, size) => {
  let filtered = [...MOCK_RECIPES];

  if (status && status !== 'ALL') {
    filtered = filtered.filter((r) => r.status === status);
  }

  if (sort === 'popular') {
    filtered.sort((a, b) => b.interest_count - a.interest_count);
  } else {
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  const totalElements = filtered.length;
  const totalPages = Math.ceil(totalElements / size) || 1;
  const start = page * size;

  // 목록에는 카드에 보여줄 필드만 포함 (content 등 상세 필드는 제외)
  const items = filtered.slice(start, start + size).map(({ recipe_id, title, summary, main_ingredient, author_type, status: s, is_fundable, interest_count, image_url, created_at }) => ({
    recipe_id, title, summary, main_ingredient, author_type, status: s, is_fundable, interest_count, image_url, created_at,
  }));

  return { recipes: items, totalElements, totalPages, currentPage: page };
};

// 레시피 상세 조회 (GET /api/recipes/:recipeId)
// - content, abv_range, ai_sub_ingredient 등 전체 필드 반환
// - 없는 ID 요청 시 null 반환 → 컨트롤러에서 404 처리
// TODO: DB 연결 후 RECIPES 테이블 SELECT WHERE recipe_id = ? 쿼리로 교체
const getRecipeById = async (recipeId) => {
  const recipe = MOCK_RECIPES.find((r) => r.recipe_id === recipeId);
  return recipe || null;
};

// TODO: DB 연결 후 이 배열 전체 삭제하고 RECIPE_INTERESTS 테이블 쿼리로 교체할 것
// 현재는 { recipe_id, user_id } 형태로 메모리에만 저장 → 서버 재시작 시 데이터 사라짐
const MOCK_INTERESTS = [];

// 관심 등록 (POST /api/recipes/:recipeId/interests)
// - 같은 (user_id, recipe_id) 조합으로 중복 등록 불가
// - 등록 후 interest_count가 INTEREST_THRESHOLD(100) 이상이면 is_fundable, status 자동 전환
// TODO: DB 연결 후 RECIPE_INTERESTS INSERT + RECIPES UPDATE 쿼리로 교체
const addInterest = async (recipeId, userId) => {
  const recipe = MOCK_RECIPES.find((r) => r.recipe_id === recipeId);
  if (!recipe) {
    const error = new Error('해당 레시피를 찾을 수 없습니다.');
    error.statusCode = 404;
    throw error;
  }

  // 동일 사용자가 같은 레시피에 중복 등록하는지 확인
  const alreadyInterested = MOCK_INTERESTS.some(
    (i) => i.recipe_id === recipeId && i.user_id === userId
  );
  if (alreadyInterested) {
    const error = new Error('이미 관심 등록한 레시피입니다.');
    error.statusCode = 400;
    throw error;
  }

  MOCK_INTERESTS.push({ recipe_id: recipeId, user_id: userId });
  recipe.interest_count += 1;

  // 임계값 초과 시 자동으로 펀딩 전환 가능 상태로 변경
  if (recipe.interest_count >= INTEREST_THRESHOLD) {
    recipe.is_fundable = true;
    recipe.status = 'FUNDING_READY';
  }

  return {
    recipe_id: recipe.recipe_id,
    interest_count: recipe.interest_count,
    is_fundable: recipe.is_fundable,
  };
};

// 관심 해제 (DELETE /api/recipes/:recipeId/interests)
// - 등록 내역이 없는 경우 400 에러
// - 해제 후에도 is_fundable이 이미 true면 되돌리지 않음 (운영 정책: 한 번 전환된 상태는 유지)
// TODO: DB 연결 후 RECIPE_INTERESTS DELETE + RECIPES UPDATE 쿼리로 교체
const removeInterest = async (recipeId, userId) => {
  const recipe = MOCK_RECIPES.find((r) => r.recipe_id === recipeId);
  if (!recipe) {
    const error = new Error('해당 레시피를 찾을 수 없습니다.');
    error.statusCode = 404;
    throw error;
  }

  const interestIndex = MOCK_INTERESTS.findIndex(
    (i) => i.recipe_id === recipeId && i.user_id === userId
  );
  if (interestIndex === -1) {
    const error = new Error('관심 등록 내역이 없습니다.');
    error.statusCode = 400;
    throw error;
  }

  MOCK_INTERESTS.splice(interestIndex, 1);
  // 0 미만으로 내려가지 않도록 보호
  recipe.interest_count = Math.max(0, recipe.interest_count - 1);

  return {
    recipe_id: recipe.recipe_id,
    interest_count: recipe.interest_count,
    is_fundable: recipe.is_fundable,
  };
};

module.exports = { createRecipe, getRecipes, getRecipeById, addInterest, removeInterest };
