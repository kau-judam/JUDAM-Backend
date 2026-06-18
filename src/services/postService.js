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

// 게시글 상세 조회 (GET /api/posts/:postId)
// userId가 null이면 is_liked, is_mine은 항상 false (비로그인)
const getPostById = async (postId, userId) => {
  const postResult = await pool.query(
    `SELECT
       p.post_id, p.title, p.content, p.board_type, p.user_id,
       u.nickname,
       u.profile_image AS author_profile_image,
       p.like_count, p.comment_count,
       CASE WHEN pl.like_id IS NOT NULL THEN true ELSE false END AS is_liked,
       CASE WHEN p.user_id = $2 THEN true ELSE false END AS is_mine,
       p.created_at, p.updated_at
     FROM posts p
     JOIN users u ON u.user_id = p.user_id
     LEFT JOIN post_likes pl ON pl.post_id = p.post_id AND pl.user_id = $2
     WHERE p.post_id = $1`,
    [postId, userId]
  );

  if (postResult.rowCount === 0) {
    const error = new Error('해당 게시글을 찾을 수 없습니다.');
    error.statusCode = 404;
    throw error;
  }

  const imagesResult = await pool.query(
    `SELECT sequence, image_url
     FROM post_images
     WHERE post_id = $1
     ORDER BY sequence ASC`,
    [postId]
  );

  const row = postResult.rows[0];
  return {
    post_id: Number(row.post_id),
    title: row.title,
    content: row.content,
    board_type: row.board_type,
    user_id: Number(row.user_id),
    nickname: row.nickname,
    author_profile_image: row.author_profile_image,
    like_count: Number(row.like_count),
    comment_count: Number(row.comment_count),
    is_liked: row.is_liked,
    is_mine: row.is_mine,
    images: imagesResult.rows.map((r) => ({
      sequence: Number(r.sequence),
      image_url: r.image_url,
    })),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

// 게시글 수정 (PUT /api/posts/:postId)
// 작성자 본인만 가능. 기존 유지(existingImageUrls) + 신규 추가(newImageUrls) 방식.
// 최종 image_urls = [...existingImageUrls, ...newImageUrls], 총 5개 이하.
const MAX_POST_IMAGES = 5;

const updatePost = async (postId, userId, { title, content, board_type, existingImageUrls = [], newImageUrls = [] }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ownerResult = await client.query(
      'SELECT user_id FROM posts WHERE post_id = $1',
      [postId]
    );

    if (ownerResult.rowCount === 0) {
      const error = new Error('해당 게시글을 찾을 수 없습니다.');
      error.statusCode = 404;
      throw error;
    }

    if (Number(ownerResult.rows[0].user_id) !== userId) {
      const error = new Error('본인이 작성한 게시글만 수정할 수 있습니다.');
      error.statusCode = 403;
      throw error;
    }

    const normalizedBoardType =
      typeof board_type === 'string' && board_type.trim() !== '' ? board_type.trim() : null;
    if (normalizedBoardType !== null && !VALID_BOARD_TYPES.has(normalizedBoardType)) {
      const error = new Error('유효하지 않은 게시판 유형입니다.');
      error.statusCode = 400;
      throw error;
    }

    // existing_image_urls 보안 검증: 각 URL이 이 post의 post_images에 실제 존재하는지
    if (existingImageUrls.length > 0) {
      const dbUrlsResult = await client.query(
        'SELECT image_url FROM post_images WHERE post_id = $1',
        [postId]
      );
      const validUrls = new Set(dbUrlsResult.rows.map((r) => r.image_url));
      const invalidUrls = existingImageUrls.filter((u) => !validUrls.has(u));
      if (invalidUrls.length > 0) {
        const error = new Error('유효하지 않은 기존 이미지 URL이 포함되어 있습니다.');
        error.statusCode = 400;
        throw error;
      }
    }

    const finalUrls = [...existingImageUrls, ...newImageUrls];
    if (finalUrls.length > MAX_POST_IMAGES) {
      const error = new Error(`이미지는 최대 ${MAX_POST_IMAGES}개까지 첨부할 수 있습니다.`);
      error.statusCode = 400;
      throw error;
    }

    const updateResult = await client.query(
      `UPDATE posts
       SET title = $2, content = $3, board_type = COALESCE($4, board_type), updated_at = CURRENT_TIMESTAMP
       WHERE post_id = $1
       RETURNING post_id, title, content, board_type, updated_at`,
      [postId, title, content, normalizedBoardType]
    );

    await client.query('DELETE FROM post_images WHERE post_id = $1', [postId]);

    for (let i = 0; i < finalUrls.length; i++) {
      await client.query(
        'INSERT INTO post_images (post_id, image_url, sequence) VALUES ($1, $2, $3)',
        [postId, finalUrls[i], i]
      );
    }

    await client.query('COMMIT');

    const row = updateResult.rows[0];
    return {
      post_id: Number(row.post_id),
      title: row.title,
      content: row.content,
      board_type: row.board_type,
      image_urls: finalUrls,
      updated_at: row.updated_at,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// 게시글 삭제 (DELETE /api/posts/:postId)
// 작성자 본인만 가능. FK ON DELETE CASCADE로 post_images, post_comments, post_likes 자동 삭제.
const deletePost = async (postId, userId) => {
  const ownerResult = await pool.query(
    'SELECT user_id FROM posts WHERE post_id = $1',
    [postId]
  );

  if (ownerResult.rowCount === 0) {
    const error = new Error('해당 게시글을 찾을 수 없습니다.');
    error.statusCode = 404;
    throw error;
  }

  if (Number(ownerResult.rows[0].user_id) !== userId) {
    const error = new Error('본인이 작성한 게시글만 삭제할 수 있습니다.');
    error.statusCode = 403;
    throw error;
  }

  await pool.query('DELETE FROM posts WHERE post_id = $1', [postId]);
};

module.exports = { createPost, getPostList, getPostById, updatePost, deletePost };
