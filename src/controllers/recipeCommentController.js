const jwt = require('jsonwebtoken');
const { getCommentsByRecipeId, createComment, updateComment, deleteComment, getCommentById, likeComment, unlikeComment } = require('../services/recipeCommentService');
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

// 댓글 수정 핸들러 (PUT /api/recipes/:recipeId/comments/:commentId)
// - 로그인 필수 (authMiddleware)
// - 작성자 본인만 수정 가능
const putComment = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);
  const commentId = parseInt(req.params.commentId, 10);
  const { content } = req.body;

  if (!content || content.trim() === '') {
    return res.status(400).json({ status: 400, message: '댓글 내용을 입력해 주세요.' });
  }

  try {
    const recipe = await getRecipeById(recipeId);
    if (!recipe) {
      return res.status(404).json({ status: 404, message: '해당 레시피를 찾을 수 없습니다.' });
    }

    const comment = await getCommentById(commentId);
    if (!comment) {
      return res.status(404).json({ status: 404, message: '해당 댓글을 찾을 수 없습니다.' });
    }

    if (comment.user_id !== Number(req.user.id)) {
      return res.status(403).json({ status: 403, message: '본인이 작성한 댓글만 수정할 수 있습니다.' });
    }

    const updated = await updateComment(commentId, content.trim());
    return res.status(200).json({ status: 200, message: '댓글이 수정되었습니다.', comment: updated });
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 댓글 삭제 핸들러 (DELETE /api/recipes/:recipeId/comments/:commentId)
// - 로그인 필수 (authMiddleware)
// - 작성자 본인만 삭제 가능
const deleteCommentHandler = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);
  const commentId = parseInt(req.params.commentId, 10);

  try {
    const recipe = await getRecipeById(recipeId);
    if (!recipe) {
      return res.status(404).json({ status: 404, message: '해당 레시피를 찾을 수 없습니다.' });
    }

    const comment = await getCommentById(commentId);
    if (!comment) {
      return res.status(404).json({ status: 404, message: '해당 댓글을 찾을 수 없습니다.' });
    }

    if (comment.user_id !== Number(req.user.id)) {
      return res.status(403).json({ status: 403, message: '본인이 작성한 댓글만 삭제할 수 있습니다.' });
    }

    await deleteComment(commentId);
    return res.status(200).json({ status: 200, message: '댓글이 삭제되었습니다.' });
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 댓글 좋아요 등록 핸들러 (POST /api/recipes/:recipeId/comments/:commentId/likes)
// - 로그인 필수 (authMiddleware)
// - 동일 사용자가 같은 댓글에 중복 좋아요 시 409
const postCommentLike = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);
  const commentId = parseInt(req.params.commentId, 10);

  try {
    const recipe = await getRecipeById(recipeId);
    if (!recipe) {
      return res.status(404).json({ status: 404, message: '해당 레시피를 찾을 수 없습니다.' });
    }

    const result = await likeComment(commentId, req.user.id);
    if (result.error === 'not_found') {
      return res.status(404).json({ status: 404, message: '해당 댓글을 찾을 수 없습니다.' });
    }
    if (result.error === 'duplicate') {
      return res.status(409).json({ status: 409, message: '이미 좋아요를 누른 댓글입니다.' });
    }

    return res.status(200).json({ status: 200, message: '좋아요가 등록되었습니다.', like_count: result.like_count });
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 댓글 좋아요 취소 핸들러 (DELETE /api/recipes/:recipeId/comments/:commentId/likes)
// - 로그인 필수 (authMiddleware)
// - 좋아요를 누르지 않은 댓글에 취소 시도 시 404
const deleteCommentLike = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);
  const commentId = parseInt(req.params.commentId, 10);

  try {
    const recipe = await getRecipeById(recipeId);
    if (!recipe) {
      return res.status(404).json({ status: 404, message: '해당 레시피를 찾을 수 없습니다.' });
    }

    const result = await unlikeComment(commentId, req.user.id);
    if (result.error === 'not_found') {
      return res.status(404).json({ status: 404, message: '해당 댓글을 찾을 수 없습니다.' });
    }
    if (result.error === 'not_liked') {
      return res.status(404).json({ status: 404, message: '좋아요를 누르지 않은 댓글입니다.' });
    }

    return res.status(200).json({ status: 200, message: '좋아요가 취소되었습니다.', like_count: result.like_count });
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

module.exports = { getCommentList, postComment, putComment, deleteCommentHandler, postCommentLike, deleteCommentLike };
