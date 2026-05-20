const pool = require('../db');

const VALID_BOARD_TYPES = new Set(['FREE', 'INFO']);

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

// 게시글 목록 조회 (GET /api/posts)
// userId가 null이면 is_liked, is_mine은 항상 false (비로그인)
const getPostList = async (boardType, sort, page, size, userId) => {
  const offset = page * size;
  const orderClause =
    sort === 'popular'
      ? 'ORDER BY p.like_count DESC, p.created_at DESC'
      : 'ORDER BY p.created_at DESC';

  let dataQuery, countQuery, dataParams, countParams;

  if (boardType && boardType !== 'ALL') {
    dataQuery = `
      SELECT
        p.post_id, p.title, p.board_type, p.user_id,
        u.nickname,
        u.profile_image AS author_profile_image,
        p.like_count, p.comment_count,
        pi.image_url AS thumbnail_url,
        p.created_at,
        CASE WHEN pl.like_id IS NOT NULL THEN true ELSE false END AS is_liked,
        CASE WHEN p.user_id = $4 THEN true ELSE false END AS is_mine
      FROM posts p
      JOIN users u ON u.user_id = p.user_id
      LEFT JOIN post_images pi ON pi.post_id = p.post_id AND pi.sequence = 0
      LEFT JOIN post_likes pl ON pl.post_id = p.post_id AND pl.user_id = $4
      WHERE p.board_type = $1
      ${orderClause}
      LIMIT $2 OFFSET $3
    `;
    dataParams = [boardType, size, offset, userId];
    countQuery = 'SELECT COUNT(*) FROM posts WHERE board_type = $1';
    countParams = [boardType];
  } else {
    dataQuery = `
      SELECT
        p.post_id, p.title, p.board_type, p.user_id,
        u.nickname,
        u.profile_image AS author_profile_image,
        p.like_count, p.comment_count,
        pi.image_url AS thumbnail_url,
        p.created_at,
        CASE WHEN pl.like_id IS NOT NULL THEN true ELSE false END AS is_liked,
        CASE WHEN p.user_id = $3 THEN true ELSE false END AS is_mine
      FROM posts p
      JOIN users u ON u.user_id = p.user_id
      LEFT JOIN post_images pi ON pi.post_id = p.post_id AND pi.sequence = 0
      LEFT JOIN post_likes pl ON pl.post_id = p.post_id AND pl.user_id = $3
      ${orderClause}
      LIMIT $1 OFFSET $2
    `;
    dataParams = [size, offset, userId];
    countQuery = 'SELECT COUNT(*) FROM posts';
    countParams = [];
  }

  const [dataResult, countResult] = await Promise.all([
    pool.query(dataQuery, dataParams),
    pool.query(countQuery, countParams),
  ]);

  const totalElements = parseInt(countResult.rows[0].count, 10);
  const totalPages = Math.ceil(totalElements / size) || 1;

  return {
    posts: dataResult.rows.map((r) => ({
      ...r,
      post_id: Number(r.post_id),
      user_id: Number(r.user_id),
      like_count: Number(r.like_count),
      comment_count: Number(r.comment_count),
    })),
    totalElements,
    totalPages,
    currentPage: page,
  };
};

module.exports = { createPost, getPostList };
