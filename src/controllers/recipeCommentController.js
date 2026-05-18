const { getCommentsByRecipeId, createComment, updateComment, deleteComment, getCommentById, likeComment, unlikeComment, getReplies, createReply } = require('../services/recipeCommentService');
const { getRecipeById } = require('../services/recipeService');

// 댓글 목록 조회 핸들러 (GET /api/recipes/:recipeId/comments)
// - 로그인 선택 (optionalAuthMiddleware — 로그인 시 is_liked, is_mine 반영)
const getCommentList = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);
  const page = Math.max(0, parseInt(req.query.page, 10) || 0);
  const size = Math.max(1, parseInt(req.query.size, 10) || 20);
  const userId = req.user?.id || null;

  try {
    const recipe = await getRecipeById(recipeId, null);
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
const postComment = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);
  const { content } = req.body;

  if (!content || content.trim() === '') {
    return res.status(400).json({ status: 400, message: '댓글 내용을 입력해 주세요.' });
  }

  try {
    const recipe = await getRecipeById(recipeId, null);
    if (!recipe) {
      return res.status(404).json({ status: 404, message: '해당 레시피를 찾을 수 없습니다.' });
    }

    const comment = await createComment(recipeId, content.trim(), req.user);
    return res.status(201).json({
      status: 201,
      message: '댓글이 작성되었습니다.',
      comment,
    });
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 댓글 수정 핸들러 (PUT /api/recipes/:recipeId/comments/:commentId)
const putComment = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);
  const commentId = parseInt(req.params.commentId, 10);
  const { content } = req.body;

  if (!content || content.trim() === '') {
    return res.status(400).json({ status: 400, message: '댓글 내용을 입력해 주세요.' });
  }

  try {
    const recipe = await getRecipeById(recipeId, null);
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
const deleteCommentHandler = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);
  const commentId = parseInt(req.params.commentId, 10);

  try {
    const recipe = await getRecipeById(recipeId, null);
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
const postCommentLike = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);
  const commentId = parseInt(req.params.commentId, 10);

  try {
    const recipe = await getRecipeById(recipeId, null);
    if (!recipe) {
      return res.status(404).json({ status: 404, message: '해당 레시피를 찾을 수 없습니다.' });
    }

    const result = await likeComment(commentId, req.user.id);
    if (result.error === 'not_found') {
      return res.status(404).json({ status: 404, message: '해당 댓글을 찾을 수 없습니다.' });
    }
    if (result.error === 'duplicate') {
      return res.status(400).json({ status: 400, message: '이미 좋아요한 댓글입니다.' });
    }

    return res.status(200).json({
      status: 200,
      message: '좋아요 등록 완료',
      data: { comment_id: commentId, like_count: result.like_count },
    });
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 댓글 좋아요 취소 핸들러 (DELETE /api/recipes/:recipeId/comments/:commentId/likes)
const deleteCommentLike = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);
  const commentId = parseInt(req.params.commentId, 10);

  try {
    const recipe = await getRecipeById(recipeId, null);
    if (!recipe) {
      return res.status(404).json({ status: 404, message: '해당 레시피를 찾을 수 없습니다.' });
    }

    const result = await unlikeComment(commentId, req.user.id);
    if (result.error === 'not_found') {
      return res.status(404).json({ status: 404, message: '해당 댓글을 찾을 수 없습니다.' });
    }
    if (result.error === 'not_liked') {
      return res.status(400).json({ status: 400, message: '좋아요를 누르지 않은 댓글입니다.' });
    }

    return res.status(200).json({
      status: 200,
      message: '좋아요 취소 완료',
      data: { comment_id: commentId, like_count: result.like_count },
    });
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 대댓글 목록 조회 핸들러 (GET /api/recipes/:recipeId/comments/:commentId/replies)
// - 로그인 선택 (optionalAuthMiddleware — 로그인 시 is_liked, is_mine 반영)
const getReplyList = async (req, res) => {
  const commentId = parseInt(req.params.commentId, 10);
  const page = Math.max(0, parseInt(req.query.page, 10) || 0);
  const size = Math.max(1, parseInt(req.query.size, 10) || 20);
  const userId = req.user?.id || null;

  try {
    const result = await getReplies(commentId, page, size, userId);
    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 대댓글 작성 핸들러 (POST /api/recipes/:recipeId/comments/:commentId/replies)
// - 로그인 필수 (authMiddleware)
const postReply = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);
  const parentCommentId = parseInt(req.params.commentId, 10);
  const { content } = req.body;

  if (!content || content.trim() === '') {
    return res.status(400).json({ status: 400, message: '대댓글 내용을 입력해 주세요.' });
  }

  try {
    const reply = await createReply(recipeId, parentCommentId, content.trim(), req.user);
    return res.status(201).json({
      status: 201,
      message: '대댓글이 등록되었습니다.',
      reply,
      parent_reply_count: reply.parent_reply_count,
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ status: 404, message: error.message });
    }
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

module.exports = { getCommentList, postComment, putComment, deleteCommentHandler, postCommentLike, deleteCommentLike, getReplyList, postReply };
