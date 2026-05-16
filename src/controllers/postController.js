const multer = require('multer');
const { uploadFileToS3 } = require('../services/s3.service');
const { createPost } = require('../services/postService');

const upload = multer({ storage: multer.memoryStorage() });

const REQUIRED_FIELDS = ['title', 'content', 'board_type'];
const MAX_IMAGES = 5;

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

module.exports = { upload, postPost };
