const pool = require('../db');

// (postId, commentId) 쌍으로 댓글 미존재 + post-comment mismatch를 함께 404로 처리
const assertCommentExists = async (client, postId, commentId) => {
  const result = await client.query(
    'SELECT 1 FROM post_comments WHERE comment_id = $1 AND post_id = $2',
    [commentId, postId]
  );
  if (result.rowCount === 0) {
    const error = new Error('해당 댓글을 찾을 수 없습니다.');
    error.statusCode = 404;
    throw error;
  }
};

// 게시글 댓글 좋아요 등록 (POST /api/posts/:postId/comments/:commentId/likes)
// - UNIQUE (comment_id, user_id) 위반 시 23505 → 중복 400
// - 트랜잭션: post_comment_likes INSERT + post_comments.like_count + 1
const likeComment = async (postId, commentId, userId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await assertCommentExists(client, postId, commentId);

    try {
      await client.query(
        'INSERT INTO post_comment_likes (comment_id, user_id) VALUES ($1, $2)',
        [commentId, userId]
      );
    } catch (e) {
      if (e.code === '23505') {
        const error = new Error('이미 좋아요한 댓글입니다.');
        error.statusCode = 400;
        throw error;
      }
      throw e;
    }

    const updated = await client.query(
      'UPDATE post_comments SET like_count = like_count + 1 WHERE comment_id = $1 RETURNING like_count',
      [commentId]
    );

    await client.query('COMMIT');

    return {
      comment_id: commentId,
      like_count: Number(updated.rows[0].like_count),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// 게시글 댓글 좋아요 취소 (DELETE /api/posts/:postId/comments/:commentId/likes)
// - 좋아요 내역 없으면 400
// - 트랜잭션: post_comment_likes DELETE + post_comments.like_count GREATEST(-1, 0)
const unlikeComment = async (postId, commentId, userId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await assertCommentExists(client, postId, commentId);

    const deleteResult = await client.query(
      'DELETE FROM post_comment_likes WHERE comment_id = $1 AND user_id = $2 RETURNING like_id',
      [commentId, userId]
    );

    if (deleteResult.rowCount === 0) {
      const error = new Error('좋아요 내역이 없습니다.');
      error.statusCode = 400;
      throw error;
    }

    const updated = await client.query(
      'UPDATE post_comments SET like_count = GREATEST(like_count - 1, 0) WHERE comment_id = $1 RETURNING like_count',
      [commentId]
    );

    await client.query('COMMIT');

    return {
      comment_id: commentId,
      like_count: Number(updated.rows[0].like_count),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { likeComment, unlikeComment };
