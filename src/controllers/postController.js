const multer = require('multer');
const { uploadFileToS3 } = require('../services/s3.service');
const {
  createPost,
  getPostList,
  getPostById,
  updatePost,
  deletePost,
} = require('../services/postService');

const upload = multer({ storage: multer.memoryStorage() });

const REQUIRED_FIELDS = ['title', 'content', 'board_type'];
const UPDATE_REQUIRED_FIELDS = ['title', 'content'];
const MAX_IMAGES = 5;
const VALID_BOARD_TYPE_PARAMS = new Set(['ALL', 'FREE', 'INFO']);

// 게시글 작성 핸들러 (POST /api/posts)
// - 로그인 필수 (authMiddleware에서 JWT 검증 후 req.user에 사용자 정보 주입)
// - 이미지 파일(req.files)이 있으면 각각 S3에 업로드 후 URL을 postService에 전달 (최대 5개)
const postPost = async (req, res) => {
  const body = req.body || {};
  const missing = REQUIRED_FIELDS.filter((f) => !body[f]);
  if (missing.length > 0) {
    return res.status(400).json({ status: 400, message: '필수 항목이 누락되었습니다.' });
  }

  const files = req.files || [];
  if (files.length > MAX_IMAGES) {
    return res.status(400).json({ status: 400, message: `이미지는 최대 ${MAX_IMAGES}개까지 첨부할 수 있습니다.` });
  }

  try {
    const imageUrls = await Promise.all(
      files.map((f) => uploadFileToS3(f.buffer, f.originalname, f.mimetype, req.user.id))
    );

    const post = await createPost({ ...body, imageUrls }, req.user);
    return res.status(201).json({
      status: 201,
      message: '게시글이 작성되었습니다.',
      post,
    });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ status: 400, message: error.message });
    }
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 게시글 목록 조회 핸들러 (GET /api/posts)
// - 로그인 선택 (optionalAuthMiddleware — 비로그인 시 is_liked, is_mine = false)
const getPosts = async (req, res) => {
  const boardTypeParam = req.query.board_type || 'ALL';

  if (!VALID_BOARD_TYPE_PARAMS.has(boardTypeParam)) {
    return res.status(400).json({ status: 400, message: '유효하지 않은 board_type입니다.' });
  }

  const sort = req.query.sort === 'popular' ? 'popular' : 'newest';
  const page = Math.max(0, parseInt(req.query.page, 10) || 0);
  const size = Math.max(1, parseInt(req.query.size, 10) || 20);
  const userId = req.user?.id || null;

  try {
    const result = await getPostList(boardTypeParam, sort, page, size, userId);
    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 게시글 상세 조회 핸들러 (GET /api/posts/:postId)
// - 로그인 선택 (optionalAuthMiddleware — 비로그인 시 is_liked, is_mine = false)
const getPostDetail = async (req, res) => {
  const postId = parseInt(req.params.postId, 10);
  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(404).json({ status: 404, message: '해당 게시글을 찾을 수 없습니다.' });
  }

  const userId = req.user?.id || null;

  try {
    const post = await getPostById(postId, userId);
    return res.status(200).json({ post });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ status: 404, message: error.message });
    }
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 게시글 수정 핸들러 (PUT /api/posts/:postId)
// - 로그인 필수 (작성자 본인만 수정 가능)
// - 이미지 = 남길 기존 URL(existing_image_urls, JSON 문자열) + 새 파일(images)을 합쳐 재구성
// - board_type 수정 불가 (요청에 포함되어도 무시)
const putPost = async (req, res) => {
  const postId = parseInt(req.params.postId, 10);
  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(404).json({ status: 404, message: '해당 게시글을 찾을 수 없습니다.' });
  }

  const body = req.body || {};
  const missing = UPDATE_REQUIRED_FIELDS.filter((f) => !body[f]);
  if (missing.length > 0) {
    return res.status(400).json({ status: 400, message: '필수 항목이 누락되었습니다.' });
  }

  let existingImageUrls = [];
  if (body.existing_image_urls !== undefined && body.existing_image_urls !== '') {
    try {
      existingImageUrls = JSON.parse(body.existing_image_urls);
    } catch {
      return res.status(400).json({ status: 400, message: 'existing_image_urls는 문자열 배열의 JSON이어야 합니다.' });
    }
    if (!Array.isArray(existingImageUrls) || !existingImageUrls.every((u) => typeof u === 'string')) {
      return res.status(400).json({ status: 400, message: 'existing_image_urls는 문자열 배열의 JSON이어야 합니다.' });
    }
  }

  const files = req.files || [];
  if (files.length > MAX_IMAGES) {
    return res.status(400).json({ status: 400, message: `이미지는 최대 ${MAX_IMAGES}개까지 첨부할 수 있습니다.` });
  }

  try {
    const newImageUrls = await Promise.all(
      files.map((f) => uploadFileToS3(f.buffer, f.originalname, f.mimetype, req.user.id))
    );

    const post = await updatePost(postId, req.user.id, {
      title: body.title,
      content: body.content,
      existingImageUrls,
      newImageUrls,
    });

    return res.status(200).json({
      status: 200,
      message: '게시글이 수정되었습니다.',
      post,
    });
  } catch (error) {
    if (error.statusCode === 400 || error.statusCode === 403 || error.statusCode === 404) {
      return res.status(error.statusCode).json({ status: error.statusCode, message: error.message });
    }
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

// 게시글 삭제 핸들러 (DELETE /api/posts/:postId)
// - 로그인 필수 (작성자 본인만 삭제 가능)
// - FK ON DELETE CASCADE로 연관 데이터(post_images/post_comments/post_likes) 자동 삭제
const deletePostHandler = async (req, res) => {
  const postId = parseInt(req.params.postId, 10);
  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(404).json({ status: 404, message: '해당 게시글을 찾을 수 없습니다.' });
  }

  try {
    await deletePost(postId, req.user.id);
    return res.status(200).json({ status: 200, message: '게시글이 삭제되었습니다.' });
  } catch (error) {
    if (error.statusCode === 403 || error.statusCode === 404) {
      return res.status(error.statusCode).json({ status: error.statusCode, message: error.message });
    }
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

module.exports = {
  upload,
  postPost,
  getPosts,
  getPostDetail,
  putPost,
  deletePostHandler,
};
