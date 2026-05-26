const {
  getCommentsByPostId,
  createComment,
  updateComment,
  deleteComment,
  getRepliesByCommentId,
  createReply,
} = require('../services/postCommentService');

// 댓글 목록 조회 핸들러 (GET /api/posts/:postId/comments)
// - 로그인 선택 (optionalAuthMiddleware — 비로그인 시 is_liked, is_mine = false)
const getCommentList = async (req, res) => {
  const postId = parseInt(req.params.postId, 10);
  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(404).json({ status: 404, message: '해당 게시글을 찾을 수 없습니다.' });
  }

  const page = Math.max(0, parseInt(req.query.page, 10) || 0);
  const size = Math.max(1, parseInt(req.query.size, 10) || 20);
  const userId = req.user?.id || null;

  try {
    const result = await getCommentsByPostId(postId, page, size, userId);
    return res.status(200).json(result);
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ status: 404, message: error.message });
    }
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 댓글 작성 핸들러 (POST /api/posts/:postId/comments)
// - 로그인 필수 (authMiddleware)
// - 댓글 작성 성공 시 posts.comment_count + 1 (서비스 트랜잭션)
const postComment = async (req, res) => {
  const postId = parseInt(req.params.postId, 10);
  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(404).json({ status: 404, message: '해당 게시글을 찾을 수 없습니다.' });
  }

  const { content } = req.body || {};
  if (!content || content.trim() === '') {
    return res.status(400).json({ status: 400, message: '댓글 내용을 입력해 주세요.' });
  }

  try {
    const comment = await createComment(postId, content.trim(), req.user);
    return res.status(201).json({
      status: 201,
      message: '댓글이 작성되었습니다.',
      comment,
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ status: 404, message: error.message });
    }
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 댓글 수정 핸들러 (PUT /api/posts/:postId/comments/:commentId)
// - 로그인 필수 (authMiddleware), 작성자 본인만 가능
const putCommentHandler = async (req, res) => {
  const postId = parseInt(req.params.postId, 10);
  const commentId = parseInt(req.params.commentId, 10);
  if (
    !Number.isInteger(postId) || postId <= 0 ||
    !Number.isInteger(commentId) || commentId <= 0
  ) {
    return res.status(404).json({ status: 404, message: '해당 댓글을 찾을 수 없습니다.' });
  }

  const { content } = req.body || {};
  if (!content || content.trim() === '') {
    return res.status(400).json({ status: 400, message: '댓글 내용을 입력해 주세요.' });
  }

  try {
    const comment = await updateComment(postId, commentId, req.user.id, content.trim());
    return res.status(200).json({
      status: 200,
      message: '댓글이 수정되었습니다.',
      comment,
    });
  } catch (error) {
    if (error.statusCode === 403 || error.statusCode === 404) {
      return res.status(error.statusCode).json({ status: error.statusCode, message: error.message });
    }
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 댓글 삭제 핸들러 (DELETE /api/posts/:postId/comments/:commentId)
// - 로그인 필수 (authMiddleware), 작성자 본인만 가능
// - 삭제 성공 시 posts.comment_count -1 (서비스 트랜잭션)
const deleteCommentHandler = async (req, res) => {
  const postId = parseInt(req.params.postId, 10);
  const commentId = parseInt(req.params.commentId, 10);
  if (
    !Number.isInteger(postId) || postId <= 0 ||
    !Number.isInteger(commentId) || commentId <= 0
  ) {
    return res.status(404).json({ status: 404, message: '해당 댓글을 찾을 수 없습니다.' });
  }

  try {
    await deleteComment(postId, commentId, req.user.id);
    return res.status(200).json({ status: 200, message: '댓글이 삭제되었습니다.' });
  } catch (error) {
    if (error.statusCode === 403 || error.statusCode === 404) {
      return res.status(error.statusCode).json({ status: error.statusCode, message: error.message });
    }
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 대댓글 목록 조회 핸들러 (GET /api/posts/:postId/comments/:commentId/replies)
// - 로그인 선택 (optionalAuthMiddleware — 비로그인 시 is_liked, is_mine = false)
// - 부모 댓글이 없어도 빈 배열 반환 (404 X) — 명세서 line 129
const getReplyList = async (req, res) => {
  const postId    = parseInt(req.params.postId, 10);
  const commentId = parseInt(req.params.commentId, 10);
  if (!Number.isInteger(postId) || postId <= 0 ||
      !Number.isInteger(commentId) || commentId <= 0) {
    return res.status(200).json({ replies: [], totalElements: 0, totalPages: 1, currentPage: 0 });
  }

  const page = Math.max(0, parseInt(req.query.page, 10) || 0);
  const size = Math.max(1, parseInt(req.query.size, 10) || 20);
  const userId = req.user?.id || null;

  try {
    const result = await getRepliesByCommentId(postId, commentId, page, size, userId);
    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 대댓글 작성 핸들러 (POST /api/posts/:postId/comments/:commentId/replies)
// - 로그인 필수 (authMiddleware)
// - 부모 댓글이 (postId, commentId) 쌍으로 존재하지 않으면 404
// - 응답: reply 객체 + 부모 댓글의 최신 대댓글 수(parent_reply_count)를 최상위에도 동봉
const postReply = async (req, res) => {
  const postId          = parseInt(req.params.postId, 10);
  const parentCommentId = parseInt(req.params.commentId, 10);
  if (!Number.isInteger(postId) || postId <= 0 ||
      !Number.isInteger(parentCommentId) || parentCommentId <= 0) {
    return res.status(404).json({ status: 404, message: '부모 댓글을 찾을 수 없습니다.' });
  }

  const { content } = req.body || {};
  if (!content || content.trim() === '') {
    return res.status(400).json({ status: 400, message: '대댓글 내용을 입력해 주세요.' });
  }

  try {
    const reply = await createReply(postId, parentCommentId, content.trim(), req.user);
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

module.exports = { getCommentList, postComment, putCommentHandler, deleteCommentHandler, getReplyList, postReply };
