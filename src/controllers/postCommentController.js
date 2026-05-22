const { getCommentsByPostId } = require('../services/postCommentService');

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

module.exports = { getCommentList };
