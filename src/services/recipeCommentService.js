const pool = require('../db');

// 댓글 목록 조회 (GET /api/recipes/:recipeId/comments)
// - userId가 null이면 is_liked, is_mine은 항상 false (비로그인)
const getCommentsByRecipeId = async (recipeId, page, size, userId) => {
  const offset = page * size;

  const dataResult = await pool.query(
    `SELECT
       rc.comment_id,
       rc.user_id,
       u.nickname        AS user_nickname,
       u.profile_image   AS author_profile_image,
       u.role            AS author_type,
       rc.content,
       rc.like_count,
       (SELECT COUNT(*)::INT FROM recipe_comments WHERE parent_comment_id = rc.comment_id) AS reply_count,
       rc.created_at,
       rc.updated_at,
       CASE WHEN rcl.like_id IS NOT NULL THEN true ELSE false END AS is_liked,
       CASE WHEN rc.user_id = $4 THEN true ELSE false END         AS is_mine
     FROM recipe_comments rc
     JOIN  users u   ON u.user_id  = rc.user_id
     LEFT JOIN recipe_comment_likes rcl
            ON rcl.comment_id = rc.comment_id AND rcl.user_id = $4
     WHERE rc.recipe_id = $1 AND rc.parent_comment_id IS NULL
     ORDER BY rc.created_at ASC
     LIMIT $2 OFFSET $3`,
    [recipeId, size, offset, userId]
  );

  const countResult = await pool.query(
    'SELECT COUNT(*) FROM recipe_comments WHERE recipe_id = $1 AND parent_comment_id IS NULL',
    [recipeId]
  );

  const totalElements = parseInt(countResult.rows[0].count, 10);
  const totalPages = Math.ceil(totalElements / size) || 1;

  const comments = dataResult.rows.map((c) => ({
    comment_id:           Number(c.comment_id),
    user_id:              Number(c.user_id),
    nickname:             c.user_nickname,
    author_profile_image: c.author_profile_image,
    author_type:          c.author_type,
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

// 댓글 작성 (POST /api/recipes/:recipeId/comments)
const createComment = async (recipeId, content, user) => {
  const nicknameResult = await pool.query(
    'SELECT nickname FROM users WHERE user_id = $1',
    [user.id]
  );
  const nickname = nicknameResult.rows[0]?.nickname || `user_${user.id}`;

  const result = await pool.query(
    `INSERT INTO recipe_comments (recipe_id, user_id, content)
     VALUES ($1, $2, $3)
     RETURNING comment_id, content, like_count, created_at, updated_at`,
    [recipeId, user.id, content]
  );

  const c = result.rows[0];
  return {
    comment_id: Number(c.comment_id),
    recipe_id:  recipeId,
    user_id:    Number(user.id),
    nickname:   nickname,
    content:    c.content,
    like_count: Number(c.like_count),
    created_at: c.created_at,
  };
};

// 댓글 수정 (PUT /api/recipes/:recipeId/comments/:commentId)
const updateComment = async (commentId, content) => {
  const result = await pool.query(
    `UPDATE recipe_comments
     SET content = $1, updated_at = NOW()
     WHERE comment_id = $2
     RETURNING comment_id, user_id, content, like_count, created_at, updated_at`,
    [content, commentId]
  );

  const c = result.rows[0];
  const nicknameResult = await pool.query(
    'SELECT nickname FROM users WHERE user_id = $1',
    [c.user_id]
  );

  return {
    comment_id:    Number(c.comment_id),
    user_nickname: nicknameResult.rows[0]?.nickname || `user_${c.user_id}`,
    content:       c.content,
    like_count:    Number(c.like_count),
    created_at:    c.created_at,
    updated_at:    c.updated_at,
  };
};

// 댓글 삭제 (DELETE /api/recipes/:recipeId/comments/:commentId)
const deleteComment = async (commentId) => {
  await pool.query('DELETE FROM recipe_comments WHERE comment_id = $1', [commentId]);
};

// 댓글 단건 조회 (권한 검증용 내부 헬퍼)
const getCommentById = async (commentId) => {
  const result = await pool.query(
    'SELECT comment_id, recipe_id, user_id FROM recipe_comments WHERE comment_id = $1',
    [commentId]
  );
  if (result.rows.length === 0) return null;
  const c = result.rows[0];
  return {
    comment_id: Number(c.comment_id),
    recipe_id:  Number(c.recipe_id),
    user_id:    Number(c.user_id),
  };
};

// 댓글 좋아요 등록 (POST /api/recipes/:recipeId/comments/:commentId/likes)
const likeComment = async (commentId, userId) => {
  const commentResult = await pool.query(
    'SELECT comment_id FROM recipe_comments WHERE comment_id = $1',
    [commentId]
  );
  if (commentResult.rows.length === 0) return { error: 'not_found' };

  try {
    await pool.query(
      'INSERT INTO recipe_comment_likes (comment_id, user_id) VALUES ($1, $2)',
      [commentId, userId]
    );
  } catch (e) {
    if (e.code === '23505') return { error: 'duplicate' };
    throw e;
  }

  const updated = await pool.query(
    'UPDATE recipe_comments SET like_count = like_count + 1 WHERE comment_id = $1 RETURNING like_count',
    [commentId]
  );
  return { like_count: Number(updated.rows[0].like_count) };
};

// 댓글 좋아요 취소 (DELETE /api/recipes/:recipeId/comments/:commentId/likes)
const unlikeComment = async (commentId, userId) => {
  const commentResult = await pool.query(
    'SELECT comment_id FROM recipe_comments WHERE comment_id = $1',
    [commentId]
  );
  if (commentResult.rows.length === 0) return { error: 'not_found' };

  const deleteResult = await pool.query(
    'DELETE FROM recipe_comment_likes WHERE comment_id = $1 AND user_id = $2 RETURNING like_id',
    [commentId, userId]
  );
  if (deleteResult.rows.length === 0) return { error: 'not_liked' };

  const updated = await pool.query(
    'UPDATE recipe_comments SET like_count = GREATEST(like_count - 1, 0) WHERE comment_id = $1 RETURNING like_count',
    [commentId]
  );
  return { like_count: Number(updated.rows[0].like_count) };
};

// 대댓글 목록 조회 (GET /api/recipes/:recipeId/comments/:commentId/replies)
// - userId가 null이면 is_liked, is_mine은 항상 false (비로그인)
const getReplies = async (parentCommentId, page, size, userId) => {
  const offset = page * size;

  const dataResult = await pool.query(
    `SELECT
       rc.comment_id,
       rc.user_id,
       u.nickname        AS user_nickname,
       u.profile_image   AS author_profile_image,
       u.role            AS author_type,
       rc.content,
       rc.like_count,
       rc.created_at,
       rc.updated_at,
       CASE WHEN rcl.like_id IS NOT NULL THEN true ELSE false END AS is_liked,
       CASE WHEN rc.user_id = $4 THEN true ELSE false END         AS is_mine
     FROM recipe_comments rc
     JOIN  users u ON u.user_id = rc.user_id
     LEFT JOIN recipe_comment_likes rcl
            ON rcl.comment_id = rc.comment_id AND rcl.user_id = $4
     WHERE rc.parent_comment_id = $1
     ORDER BY rc.created_at ASC
     LIMIT $2 OFFSET $3`,
    [parentCommentId, size, offset, userId]
  );

  const countResult = await pool.query(
    'SELECT COUNT(*) FROM recipe_comments WHERE parent_comment_id = $1',
    [parentCommentId]
  );

  const totalElements = parseInt(countResult.rows[0].count, 10);
  const totalPages = Math.ceil(totalElements / size) || 1;

  const replies = dataResult.rows.map((c) => ({
    comment_id:           Number(c.comment_id),
    user_id:              Number(c.user_id),
    nickname:             c.user_nickname,
    author_profile_image: c.author_profile_image,
    author_type:          c.author_type,
    content:              c.content,
    like_count:           Number(c.like_count),
    is_liked:             c.is_liked,
    is_mine:              c.is_mine,
    created_at:           c.created_at,
    updated_at:           c.updated_at,
  }));

  return { replies, totalElements, totalPages, currentPage: page };
};

// 대댓글 작성 (POST /api/recipes/:recipeId/comments/:commentId/replies)
const createReply = async (recipeId, parentCommentId, content, user) => {
  const parentResult = await pool.query(
    'SELECT comment_id FROM recipe_comments WHERE comment_id = $1',
    [parentCommentId]
  );
  if (parentResult.rows.length === 0) {
    const error = new Error('부모 댓글을 찾을 수 없습니다.');
    error.statusCode = 404;
    throw error;
  }

  const nicknameResult = await pool.query(
    'SELECT nickname FROM users WHERE user_id = $1',
    [user.id]
  );
  const nickname = nicknameResult.rows[0]?.nickname || `user_${user.id}`;

  const result = await pool.query(
    `INSERT INTO recipe_comments (recipe_id, user_id, content, parent_comment_id)
     VALUES ($1, $2, $3, $4)
     RETURNING comment_id, content, like_count, created_at`,
    [recipeId, user.id, content, parentCommentId]
  );

  const replyCountResult = await pool.query(
    'SELECT COUNT(*)::INT AS reply_count FROM recipe_comments WHERE parent_comment_id = $1',
    [parentCommentId]
  );

  const c = result.rows[0];
  return {
    comment_id:         Number(c.comment_id),
    recipe_id:          recipeId,
    parent_comment_id:  parentCommentId,
    user_id:            Number(user.id),
    nickname:           nickname,
    content:            c.content,
    like_count:         Number(c.like_count),
    created_at:         c.created_at,
    parent_reply_count: Number(replyCountResult.rows[0].reply_count),
  };
};

module.exports = { getCommentsByRecipeId, createComment, updateComment, deleteComment, getCommentById, likeComment, unlikeComment, getReplies, createReply };
