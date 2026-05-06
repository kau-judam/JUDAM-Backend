const { generatePresignedUrl } = require('../services/s3.service');

const ALLOWED_FILE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// presigned URL 발급 핸들러 (GET /api/s3/presigned-url)
// - 로그인 필수 (authMiddleware에서 JWT 검증 후 req.user에 사용자 정보 주입)
// - 쿼리 파라미터: filename(파일명), fileType(MIME 타입)
// - 반환: presignedUrl(업로드용 PUT URL), s3Url(업로드 후 접근 URL)
const getPresignedUrl = async (req, res) => {
  const { filename, fileType } = req.query;

  if (!filename || !fileType) {
    return res.status(400).json({ status: 400, message: 'filename과 fileType은 필수입니다.' });
  }

  if (!ALLOWED_FILE_TYPES.has(fileType)) {
    return res.status(400).json({ status: 400, message: '허용되지 않는 파일 형식입니다. (jpeg, png, webp, gif만 허용)' });
  }

  try {
    const { presignedUrl, s3Url } = await generatePresignedUrl(req.user.id, filename, fileType);
    return res.status(200).json({ status: 200, presignedUrl, s3Url });
  } catch {
    return res.status(500).json({ status: 500, message: '서버 내부 오류' });
  }
};

module.exports = { getPresignedUrl };
