const jwt = require('jsonwebtoken');
const { getCommentsByRecipeId, createComment } = require('../services/recipeCommentService');
const { getRecipeById } = require('../services/recipeService');

// 댓글 목록 조회 핸들러 (GET /api/recipes/:recipeId/comments)
// - 로그인 불필요 (비로그인 시 is_liked = false)
// - Bearer 토큰이 있으면 선택적으로 파싱해 is_liked에 반영
const getCommentList = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);
  const page = Math.max(0, parseInt(req.query.page, 10) || 0);
  const size = Math.max(1, parseInt(req.query.size, 10) || 20);

  // 선택적 인증: 유효한 토큰이면 userId 추출, 없거나 만료여도 목록 조회는 허용
  let userId = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
      userId = decoded.id;
    } catch {} // 토큰 오류여도 비로그인으로 처리 (is_liked = false)
  }

  try {
    const recipe = await getRecipeById(recipeId);
    if (!recipe) {
      return res.status(404).json({ status: 404, message: '해당 레시피를 찾을 수 없습니다.' });
    }

    const result = await getCommentsByRecipeId(recipeId, page, size, userId);
    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 댓글 작성 핸들러 (POST /api/recipes/:recipeId/comments)
// - 로그인 필수 (authMiddleware에서 JWT 검증 후 req.user에 사용자 정보 주입)
// - 요청 바디: { content }
const postComment = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);
  const { content } = req.body;

  if (!content || content.trim() === '') {
    return res.status(400).json({ status: 400, message: '댓글 내용을 입력해 주세요.' });
  }

  try {
    const recipe = await getRecipeById(recipeId);
    if (!recipe) {
      return res.status(404).json({ status: 404, message: '해당 레시피를 찾을 수 없습니다.' });
    }

    const comment = await createComment(recipeId, content.trim(), req.user);
    return res.status(201).json({
      status: 201,
      message: '댓글이 등록되었습니다.',
      comment,
    });
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

module.exports = { getCommentList, postComment };
