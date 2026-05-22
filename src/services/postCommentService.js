const pool = require('../db');

const assertPostExists = async (client, postId) => {
  const result = await client.query('SELECT 1 FROM posts WHERE post_id = $1', [postId]);
  if (result.rowCount === 0) {
    const error = new Error('해당 게시글을 찾을 수 없습니다.');
    error.statusCode = 404;
    throw error;
  }
};

// 게시글 댓글 목록 조회 (GET /api/posts/:postId/comments)
// - parent_comment_id IS NULL — 루트 댓글만 (대댓글 제외)
// - created_at ASC — 오래된 댓글 먼저
// - userId가 null이면 is_liked, is_mine은 항상 false (비로그인)
const getCommentsByPostId = async (postId, page, size, userId) => {
  await assertPostExists(pool, postId);

  const offset = page * size;

  const dataResult = await pool.query(
    `SELECT
       pc.comment_id,
       pc.user_id,
       u.nickname        AS user_nickname,
       u.profile_image   AS author_profile_image,
       pc.content,
       pc.like_count,
       (SELECT COUNT(*)::INT FROM post_comments WHERE parent_comment_id = pc.comment_id) AS reply_count,
       pc.created_at,
       pc.updated_at,
       CASE WHEN pcl.like_id IS NOT NULL THEN true ELSE false END AS is_liked,
       CASE WHEN pc.user_id = $4 THEN true ELSE false END         AS is_mine
     FROM post_comments pc
     JOIN users u ON u.user_id = pc.user_id
     LEFT JOIN post_comment_likes pcl
            ON pcl.comment_id = pc.comment_id AND pcl.user_id = $4
     WHERE pc.post_id = $1 AND pc.parent_comment_id IS NULL
     ORDER BY pc.created_at ASC
     LIMIT $2 OFFSET $3`,
    [postId, size, offset, userId]
  );

  const countResult = await pool.query(
    'SELECT COUNT(*) FROM post_comments WHERE post_id = $1 AND parent_comment_id IS NULL',
    [postId]
  );

  const totalElements = parseInt(countResult.rows[0].count, 10);
  const totalPages = Math.ceil(totalElements / size) || 1;

  const comments = dataResult.rows.map((c) => ({
    comment_id:           Number(c.comment_id),
    user_id:              Number(c.user_id),
    nickname:             c.user_nickname,
    author_profile_image: c.author_profile_image,
    content:              c.content,
    like_count:           Number(c.like_count),
    reply_count:          Number(c.reply_count),
    is_liked:             c.is_liked,
    is_mine:              c.is_mine,
    created_at:           c.created_at,
    updated_at:           c.updated_at,
  }));

  return { comments, totalElements, totalPages, currentPage: page };
};

module.exports = { getCommentsByPostId };
