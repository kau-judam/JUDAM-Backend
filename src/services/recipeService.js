const { checkRecipeLegalFilter } = require('../utils/aiFilterInterface');

// TODO: DB 연결 후 이 배열 전체 삭제하고 실제 쿼리로 교체할 것
const MOCK_RECIPES = [
  {
    recipe_id: 1,
    title: '달콤한 복숭아 막걸리',
    content: '복숭아 과즙을 활용한 저도수 막걸리. 발효 7일 후 복숭아 원액을 블렌딩합니다.',
    abv_range: '6~8%',
    main_ingredient: '쌀, 복숭아',
    ai_sub_ingredient: null,
    target_flavor: '달콤하고 과일향이 풍부하게',
    concept: '여름에 시원하게 즐기는 과일 막걸리',
    summary: '복숭아향 가득한 달콤한 저도수 막걸리',
    author_type: 'CONSUMER',
    status: 'FUNDING_READY',
    is_fundable: true,
    interest_count: 105,
    image_url: null,
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
    status: 'PUBLISHED',
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
  const items = filtered.slice(start, start + size).map(({ recipe_id, title, summary, main_ingredient, author_type, status: s, is_fundable, interest_count, image_url, created_at }) => ({
    recipe_id, title, summary, main_ingredient, author_type, status: s, is_fundable, interest_count, image_url, created_at,
  }));

  return { recipes: items, totalElements, totalPages, currentPage: page };
};

const getRecipeById = async (recipeId) => {
  const recipe = MOCK_RECIPES.find((r) => r.recipe_id === recipeId);
  return recipe || null;
};

module.exports = { createRecipe, getRecipes, getRecipeById };
