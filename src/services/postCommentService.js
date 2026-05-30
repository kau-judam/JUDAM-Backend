const pool = require('../db');

const normalizeWriterRole = (role) => String(role || 'USER').toUpperCase();
const isBreweryRole = (role) => normalizeWriterRole(role).startsWith('BREWERY');

const mapWriterFields = (row = {}) => {
  const writerId = row.user_id === null || row.user_id === undefined
    ? null
    : Number(row.user_id);
  const writerRole = normalizeWriterRole(row.writer_role);

  return {
    writerId,
    writer_id: writerId,
    userId: writerId,
    user_id: writerId,
    writerNickname: row.user_nickname || '사용자',
    writerProfileImage: row.author_profile_image || null,
    profileImage: row.author_profile_image || null,
    writerRole,
    role: writerRole,
    isBrewery: isBreweryRole(writerRole),
    writerIsBrewery: isBreweryRole(writerRole),
  };
};

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
       u.role            AS writer_role,
       pc.content,
       pc.like_count,
       (SELECT COUNT(*)::INT FROM post_comments WHERE parent_comment_id = pc.comment_id) AS reply_count,
       pc.created_at,
       pc.updated_at,
       CASE WHEN pcl.like_id IS NOT NULL THEN true ELSE false END AS is_liked,
       CASE WHEN pc.user_id = $4 THEN true ELSE false END         AS is_mine
     FROM post_comments pc
     LEFT JOIN users u ON u.user_id = pc.user_id
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
    user_id:              c.user_id === null || c.user_id === undefined ? null : Number(c.user_id),
    nickname:             c.user_nickname,
    author_profile_image: c.author_profile_image,
    ...mapWriterFields(c),
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

// 게시글 댓글 작성 (POST /api/posts/:postId/comments)
// - 트랜잭션: post_comments INSERT + posts.comment_count + 1
const createComment = async (postId, content, user) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await assertPostExists(client, postId);

    const insertResult = await client.query(
      `INSERT INTO post_comments (post_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING comment_id, content, like_count, created_at`,
      [postId, user.id, content]
    );

    await client.query(
      'UPDATE posts SET comment_count = comment_count + 1 WHERE post_id = $1',
      [postId]
    );

    const nicknameResult = await client.query(
      'SELECT nickname, profile_image, role FROM users WHERE user_id = $1',
      [user.id]
    );

    await client.query('COMMIT');

    const c = insertResult.rows[0];
    return {
      comment_id: Number(c.comment_id),
      post_id:    postId,
      user_id:    Number(user.id),
      nickname:   nicknameResult.rows[0]?.nickname || `user_${user.id}`,
      ...mapWriterFields({
        user_id: user.id,
        user_nickname: nicknameResult.rows[0]?.nickname,
        author_profile_image: nicknameResult.rows[0]?.profile_image,
        writer_role: nicknameResult.rows[0]?.role,
      }),
      content:    c.content,
      like_count: Number(c.like_count),
      created_at: c.created_at,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// 게시글 댓글 수정 (PUT /api/posts/:postId/comments/:commentId)
// - postId/commentId 모두 일치하는 댓글만 식별 (다른 게시글 소속이거나 post 자체가 없으면 404)
// - 작성자 본인만 가능 (JWT user_id == post_comments.user_id)
// - updated_at은 CURRENT_TIMESTAMP로 갱신
const updateComment = async (postId, commentId, userId, content) => {
  const ownerResult = await pool.query(
    'SELECT user_id FROM post_comments WHERE comment_id = $1 AND post_id = $2',
    [commentId, postId]
  );

  if (ownerResult.rowCount === 0) {
    const error = new Error('해당 댓글을 찾을 수 없습니다.');
    error.statusCode = 404;
    throw error;
  }

  if (Number(ownerResult.rows[0].user_id) !== Number(userId)) {
    const error = new Error('본인이 작성한 댓글만 수정할 수 있습니다.');
    error.statusCode = 403;
    throw error;
  }

  const updateResult = await pool.query(
    `UPDATE post_comments
     SET content = $1, updated_at = CURRENT_TIMESTAMP
     WHERE comment_id = $2
     RETURNING comment_id, content, updated_at`,
    [content, commentId]
  );

  const c = updateResult.rows[0];
  return {
    comment_id: Number(c.comment_id),
    content:    c.content,
    updated_at: c.updated_at,
  };
};

// 게시글 댓글 삭제 (DELETE /api/posts/:postId/comments/:commentId)
// - postId/commentId 모두 일치하는 댓글만 식별
// - 작성자 본인만 가능
// - 트랜잭션: post_comments DELETE + posts.comment_count GREATEST(-1, 0)
// - post_comment_likes는 FK ON DELETE CASCADE로 자동 정리
const deleteComment = async (postId, commentId, userId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ownerResult = await client.query(
      'SELECT user_id FROM post_comments WHERE comment_id = $1 AND post_id = $2',
      [commentId, postId]
    );

    if (ownerResult.rowCount === 0) {
      const error = new Error('해당 댓글을 찾을 수 없습니다.');
      error.statusCode = 404;
      throw error;
    }

    if (Number(ownerResult.rows[0].user_id) !== Number(userId)) {
      const error = new Error('본인이 작성한 댓글만 삭제할 수 있습니다.');
      error.statusCode = 403;
      throw error;
    }

    await client.query('DELETE FROM post_comments WHERE comment_id = $1', [commentId]);

    await client.query(
      'UPDATE posts SET comment_count = GREATEST(comment_count - 1, 0) WHERE post_id = $1',
      [postId]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// 게시글 대댓글 목록 조회 (GET /api/posts/:postId/comments/:commentId/replies)
// - WHERE parent_comment_id = commentId — 부모 댓글의 직속 자식만
// - created_at ASC — 오래된 대댓글 먼저
// - 부모 댓글이 없어도 빈 배열 반환 (명세서 line 129)
// - userId가 null이면 is_liked, is_mine은 항상 false (비로그인)
const getRepliesByCommentId = async (postId, parentCommentId, page, size, userId) => {
  const offset = page * size;

  const dataResult = await pool.query(
    `SELECT
       pc.comment_id,
       pc.user_id,
       u.nickname        AS user_nickname,
       u.profile_image   AS author_profile_image,
       u.role            AS writer_role,
       pc.content,
       pc.created_at,
       pc.updated_at,
       CASE WHEN pcl.like_id IS NOT NULL THEN true ELSE false END AS is_liked,
       CASE WHEN pc.user_id = $4 THEN true ELSE false END         AS is_mine
     FROM post_comments pc
     LEFT JOIN users u ON u.user_id = pc.user_id
     LEFT JOIN post_comment_likes pcl
            ON pcl.comment_id = pc.comment_id AND pcl.user_id = $4
     WHERE pc.parent_comment_id = $1
     ORDER BY pc.created_at ASC
     LIMIT $2 OFFSET $3`,
    [parentCommentId, size, offset, userId]
  );

  const countResult = await pool.query(
    'SELECT COUNT(*) FROM post_comments WHERE parent_comment_id = $1',
    [parentCommentId]
  );

  const totalElements = parseInt(countResult.rows[0].count, 10);
  const totalPages = Math.ceil(totalElements / size) || 1;

  const replies = dataResult.rows.map((c) => ({
    comment_id:           Number(c.comment_id),
    user_id:              c.user_id === null || c.user_id === undefined ? null : Number(c.user_id),
    nickname:             c.user_nickname,
    author_profile_image: c.author_profile_image,
    ...mapWriterFields(c),
    content:              c.content,
    is_liked:             c.is_liked,
    is_mine:              c.is_mine,
    created_at:           c.created_at,
    updated_at:           c.updated_at,
  }));

  return { replies, totalElements, totalPages, currentPage: page };
};

// 게시글 대댓글 작성 (POST /api/posts/:postId/comments/:commentId/replies)
// - 부모 댓글이 (postId, commentId) 쌍으로 존재해야 함 — 그렇지 않으면 404
// - parent_comment_id를 설정해 post_comments INSERT
// - 작성 직후 부모 댓글의 최신 대댓글 수를 함께 반환 (parent_reply_count)
// - 레시피 대댓글 작성 패턴과 동일: posts.comment_count는 갱신하지 않음
const createReply = async (postId, parentCommentId, content, user) => {
  const parentResult = await pool.query(
    'SELECT comment_id FROM post_comments WHERE comment_id = $1 AND post_id = $2',
    [parentCommentId, postId]
  );
  if (parentResult.rowCount === 0) {
    const error = new Error('부모 댓글을 찾을 수 없습니다.');
    error.statusCode = 404;
    throw error;
  }

  const nicknameResult = await pool.query(
    'SELECT nickname, profile_image, role FROM users WHERE user_id = $1',
    [user.id]
  );
  const nickname = nicknameResult.rows[0]?.nickname || `user_${user.id}`;

  const insertResult = await pool.query(
    `INSERT INTO post_comments (post_id, user_id, content, parent_comment_id)
     VALUES ($1, $2, $3, $4)
     RETURNING comment_id, content, created_at`,
    [postId, user.id, content, parentCommentId]
  );

  const replyCountResult = await pool.query(
    'SELECT COUNT(*)::INT AS reply_count FROM post_comments WHERE parent_comment_id = $1',
    [parentCommentId]
  );

  const c = insertResult.rows[0];
  return {
    comment_id:         Number(c.comment_id),
    post_id:            postId,
    parent_comment_id:  parentCommentId,
    user_id:            Number(user.id),
    nickname:           nickname,
    ...mapWriterFields({
      user_id: user.id,
      user_nickname: nickname,
      author_profile_image: nicknameResult.rows[0]?.profile_image,
      writer_role: nicknameResult.rows[0]?.role,
    }),
    content:            c.content,
    created_at:         c.created_at,
    parent_reply_count: Number(replyCountResult.rows[0].reply_count),
  };
};

module.exports = { getCommentsByPostId, createComment, updateComment, deleteComment, getRepliesByCommentId, createReply };
