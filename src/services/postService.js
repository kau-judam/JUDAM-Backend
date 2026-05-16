const pool = require('../db');

const VALID_BOARD_TYPES = new Set(['FREE', 'TASTING_REVIEW', 'RECIPE_DISCUSSION']);

// 게시글 작성 (POST /api/posts)
// imageUrls: 컨트롤러에서 S3 업로드 후 전달된 URL 배열
const createPost = async ({ title, content, board_type, imageUrls = [] }, user) => {
  if (!VALID_BOARD_TYPES.has(board_type)) {
    const error = new Error('유효하지 않은 게시판 유형입니다.');
    error.statusCode = 400;
    throw error;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const postResult = await client.query(
      `WITH inserted AS (
         INSERT INTO posts (user_id, title, board_type, content)
         VALUES ($1, $2, $3, $4)
         RETURNING post_id, title, board_type, user_id, like_count, comment_count, created_at
       )
       SELECT i.*, u.nickname
       FROM inserted i
       JOIN users u ON u.user_id = i.user_id`,
      [user.id, title, board_type, content]
    );

    const row = postResult.rows[0];
    const postId = parseInt(row.post_id);

    for (let i = 0; i < imageUrls.length; i++) {
      await client.query(
        'INSERT INTO post_images (post_id, image_url, sequence) VALUES ($1, $2, $3)',
        [postId, imageUrls[i], i]
      );
    }

    await client.query('COMMIT');

    return {
      post_id: postId,
      title: row.title,
      board_type: row.board_type,
      user_id: parseInt(row.user_id),
      nickname: row.nickname,
      like_count: row.like_count,
      comment_count: row.comment_count,
      image_urls: imageUrls,
      created_at: row.created_at,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { createPost };
