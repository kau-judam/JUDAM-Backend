const { likePost, unlikePost } = require('../services/postLikeService');

// 좋아요 등록 핸들러 (POST /api/posts/:postId/likes)
// - 로그인 필수 (authMiddleware)
// - 명세서대로 성공 status는 200 (201 아님)
const postLike = async (req, res) => {
  const postId = parseInt(req.params.postId, 10);
  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(404).json({ status: 404, message: '해당 게시글을 찾을 수 없습니다.' });
  }

  try {
    const data = await likePost(postId, req.user.id);
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

// 좋아요 취소 핸들러 (DELETE /api/posts/:postId/likes)
// - 로그인 필수 (authMiddleware)
const deleteLike = async (req, res) => {
  const postId = parseInt(req.params.postId, 10);
  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(404).json({ status: 404, message: '해당 게시글을 찾을 수 없습니다.' });
  }

  try {
    const data = await unlikePost(postId, req.user.id);
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

module.exports = { postLike, deleteLike };
