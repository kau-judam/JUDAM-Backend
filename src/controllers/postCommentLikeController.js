const { likeComment, unlikeComment } = require('../services/postCommentLikeService');

// 댓글 좋아요 등록 핸들러 (POST /api/posts/:postId/comments/:commentId/likes)
// - 로그인 필수 (authMiddleware)
// - 명세서대로 성공 status는 200
const postCommentLike = async (req, res) => {
  const postId    = parseInt(req.params.postId, 10);
  const commentId = parseInt(req.params.commentId, 10);
  if (!Number.isInteger(postId) || postId <= 0 ||
      !Number.isInteger(commentId) || commentId <= 0) {
    return res.status(404).json({ status: 404, message: '해당 댓글을 찾을 수 없습니다.' });
  }

  try {
    const data = await likeComment(postId, commentId, req.user.id);
    return res.status(200).json({
      status: 200,
      message: '좋아요 등록 완료',
      data,
    });
  } catch (error) {
    if (error.statusCode === 400 || error.statusCode === 404) {
      return res.status(error.statusCode).json({ status: error.statusCode, message: error.message });
    }
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 댓글 좋아요 취소 핸들러 (DELETE /api/posts/:postId/comments/:commentId/likes)
// - 로그인 필수 (authMiddleware)
const deleteCommentLike = async (req, res) => {
  const postId    = parseInt(req.params.postId, 10);
  const commentId = parseInt(req.params.commentId, 10);
  if (!Number.isInteger(postId) || postId <= 0 ||
      !Number.isInteger(commentId) || commentId <= 0) {
    return res.status(404).json({ status: 404, message: '해당 댓글을 찾을 수 없습니다.' });
  }

  try {
    const data = await unlikeComment(postId, commentId, req.user.id);
    return res.status(200).json({
      status: 200,
      message: '좋아요 취소 완료',
      data,
    });
  } catch (error) {
    if (error.statusCode === 400 || error.statusCode === 404) {
      return res.status(error.statusCode).json({ status: error.statusCode, message: error.message });
    }
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

module.exports = { postCommentLike, deleteCommentLike };
