const pool = require('../db');

const assertPostExists = async (client, postId) => {
  const result = await client.query('SELECT 1 FROM posts WHERE post_id = $1', [postId]);
  if (result.rowCount === 0) {
    const error = new Error('해당 게시글을 찾을 수 없습니다.');
    error.statusCode = 404;
    throw error;
  }
};

// 게시글 좋아요 등록 (POST /api/posts/:postId/likes)
// - UNIQUE (post_id, user_id) 위반 시 23505 → 중복 400
// - 트랜잭션: post_likes INSERT + posts.like_count + 1
const likePost = async (postId, userId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await assertPostExists(client, postId);

    try {
      await client.query(
        'INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)',
        [postId, userId]
      );
    } catch (e) {
      if (e.code === '23505') {
        const error = new Error('이미 좋아요한 게시글입니다.');
        error.statusCode = 400;
        throw error;
      }
      throw e;
    }

    const updated = await client.query(
      'UPDATE posts SET like_count = like_count + 1 WHERE post_id = $1 RETURNING like_count',
      [postId]
    );

    await client.query('COMMIT');

    return {
      post_id:    postId,
      like_count: Number(updated.rows[0].like_count),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// 게시글 좋아요 취소 (DELETE /api/posts/:postId/likes)
// - 좋아요 내역 없으면 400
// - 트랜잭션: post_likes DELETE + posts.like_count GREATEST(-1, 0)
const unlikePost = async (postId, userId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await assertPostExists(client, postId);

    const deleteResult = await client.query(
      'DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2 RETURNING like_id',
      [postId, userId]
    );

    if (deleteResult.rowCount === 0) {
      const error = new Error('좋아요 내역이 없습니다.');
      error.statusCode = 400;
      throw error;
    }

    const updated = await client.query(
      'UPDATE posts SET like_count = GREATEST(like_count - 1, 0) WHERE post_id = $1 RETURNING like_count',
      [postId]
    );

    await client.query('COMMIT');

    return {
      post_id:    postId,
      like_count: Number(updated.rows[0].like_count),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { likePost, unlikePost };
