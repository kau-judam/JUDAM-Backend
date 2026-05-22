const {
  getMyProfile,
  checkNickname,
  updateNickname,
  updateProfileImage,
  changeMyPassword,
  requestPhoneVerification,
  updatePhoneNumberWithVerification,
  getMyPageSummary,
  getMySulbti,
  saveMySulbti,
  getMyArchives,
  getMyArchiveDetail,
  createMyArchive,
  updateMyArchive,
  deleteMyArchive,
  getArchiveTags,
  uploadArchiveImages,
  deleteArchiveImage,
} = require('../services/mypage.service');

const UNAUTHORIZED_RESPONSE = {
  status: 401,
  message: '유효하지 않거나 만료된 토큰입니다.',
};

const getAuthenticatedUserId = (req, res) => {
  const userId = req.user?.userId;

  if (!userId) {
    res.status(401).json(UNAUTHORIZED_RESPONSE);
    return null;
  }

  return userId;
};

const getErrorStatus = (error) => error.statusCode || error.status || 500;

const sendErrorResponse = (res, error, fallbackMessage) => {
  const status = getErrorStatus(error);

  if (status === 404) {
    return res.status(404).json({
      status: 404,
      message: '사용자를 찾을 수 없습니다.',
    });
  }

  if (status === 409) {
    return res.status(409).json({
      status: 409,
      message: '이미 사용 중인 닉네임입니다.',
    });
  }

  return res.status(500).json({
    status: 500,
    message: fallbackMessage,
  });
};

const normalizeRequiredString = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
};

const sendArchiveErrorResponse = (res, error, fallbackMessage) => {
  const status = getErrorStatus(error);

  if (status === 400 || status === 404) {
    return res.status(status).json({
      status,
      message: error.message,
    });
  }

  return res.status(500).json({
    status: 500,
    message: fallbackMessage,
  });
};

const getMyProfileController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    const data = await getMyProfile(userId);

    return res.status(200).json({
      status: 200,
      message: '내 정보 조회 성공',
      data,
    });
  } catch (error) {
    return sendErrorResponse(res, error, '내 정보 조회 중 서버 오류가 발생했습니다.');
  }
};

const getMyPageSummaryController = async (req, res) => {
  const userId = req.user?.userId;

  if (!userId) {
    return res.status(401).json(UNAUTHORIZED_RESPONSE);
  }

  try {
    const data = await getMyPageSummary(userId);

    return res.status(200).json({
      status: 200,
      message: '마이페이지 메인 요약 조회 성공',
      data,
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '마이페이지 메인 요약 조회 중 서버 오류가 발생했습니다.',
    });
  }
};

const getMySulbtiController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    const data = await getMySulbti(userId);

    return res.status(200).json({
      status: 200,
      message: data.hasResult ? '술BTI 결과 조회 성공' : '술BTI 결과가 없습니다.',
      data,
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '술BTI 결과 조회 중 서버 오류가 발생했습니다.',
    });
  }
};

const saveMySulbtiController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    const data = await saveMySulbti(userId, req.body);

    return res.status(201).json({
      status: 201,
      message: '술BTI 결과 저장 성공',
      data,
    });
  } catch (error) {
    const status = getErrorStatus(error);

    if (status === 400) {
      return res.status(400).json({
        status: 400,
        message: error.message,
      });
    }

    return res.status(500).json({
      status: 500,
      message: '술BTI 결과 저장 중 서버 오류가 발생했습니다.',
    });
  }
};

const getMyArchivesController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    const {
      data,
      page,
      size,
      totalElements,
      totalPages,
    } = await getMyArchives(userId, req.query);

    return res.status(200).json({
      status: 200,
      message: '아카이브 목록 조회 성공',
      data,
      page,
      size,
      totalElements,
      totalPages,
    });
  } catch (error) {
    return sendArchiveErrorResponse(
      res,
      error,
      '아카이브 목록 조회 중 서버 오류가 발생했습니다.',
    );
  }
};

const getMyArchiveDetailController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    const data = await getMyArchiveDetail(userId, req.params.archiveId);

    return res.status(200).json({
      status: 200,
      message: '아카이브 상세 조회 성공',
      data,
    });
  } catch (error) {
    return sendArchiveErrorResponse(
      res,
      error,
      '아카이브 상세 조회 중 서버 오류가 발생했습니다.',
    );
  }
};

const createMyArchiveController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    const data = await createMyArchive(userId, req.body);

    return res.status(201).json({
      status: 201,
      message: '아카이브 작성 성공',
      data,
    });
  } catch (error) {
    return sendArchiveErrorResponse(
      res,
      error,
      '아카이브 작성 중 서버 오류가 발생했습니다.',
    );
  }
};

const updateMyArchiveController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    const data = await updateMyArchive(userId, req.params.archiveId, req.body);

    return res.status(200).json({
      status: 200,
      message: '아카이브 수정 성공',
      data,
    });
  } catch (error) {
    return sendArchiveErrorResponse(
      res,
      error,
      '아카이브 수정 중 서버 오류가 발생했습니다.',
    );
  }
};

const deleteMyArchiveController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    await deleteMyArchive(userId, req.params.archiveId);

    return res.status(200).json({
      status: 200,
      message: '아카이브 삭제 성공',
    });
  } catch (error) {
    return sendArchiveErrorResponse(
      res,
      error,
      '아카이브 삭제 중 서버 오류가 발생했습니다.',
    );
  }
};

const uploadArchiveImagesController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    const data = await uploadArchiveImages(userId, req.params.archiveId, req.files);

    return res.status(201).json({
      status: 201,
      message: '아카이브 이미지 업로드 성공',
      data,
    });
  } catch (error) {
    return sendArchiveErrorResponse(
      res,
      error,
      '아카이브 이미지 업로드 중 서버 오류가 발생했습니다.',
    );
  }
};

const deleteArchiveImageController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    await deleteArchiveImage(userId, req.params.archiveId, req.params.imageId);

    return res.status(200).json({
      status: 200,
      message: '아카이브 이미지 삭제 성공',
    });
  } catch (error) {
    return sendArchiveErrorResponse(
      res,
      error,
      '아카이브 이미지 삭제 중 서버 오류가 발생했습니다.',
    );
  }
};

const getArchiveTagsController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    const data = await getArchiveTags();

    return res.status(200).json({
      status: 200,
      message: '아카이브 태그 목록 조회 성공',
      data,
    });
  } catch (error) {
    return sendArchiveErrorResponse(
      res,
      error,
      '아카이브 태그 목록 조회 중 서버 오류가 발생했습니다.',
    );
  }
};

const checkNicknameController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  const nickname = normalizeRequiredString(req.query.nickname);

  if (!nickname) {
    return res.status(400).json({
      status: 400,
      message: '닉네임을 입력해주세요.',
    });
  }

  try {
    const data = await checkNickname(userId, nickname);

    return res.status(200).json({
      status: 200,
      message: data.isAvailable
        ? '사용 가능한 닉네임입니다.'
        : '이미 사용 중인 닉네임입니다.',
      data,
    });
  } catch (error) {
    return sendErrorResponse(res, error, '닉네임 중복 확인 중 서버 오류가 발생했습니다.');
  }
};

const updateNicknameController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  const nickname = normalizeRequiredString(req.body?.nickname);

  if (!nickname) {
    return res.status(400).json({
      status: 400,
      message: '닉네임을 입력해주세요.',
    });
  }

  try {
    const data = await updateNickname(userId, nickname);

    return res.status(200).json({
      status: 200,
      message: '닉네임 수정 성공',
      data,
    });
  } catch (error) {
    return sendErrorResponse(res, error, '닉네임 수정 중 서버 오류가 발생했습니다.');
  }
};

const updatePhoneNumberController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  const phoneNumber = normalizeRequiredString(req.body?.phoneNumber);
  const verificationCode = normalizeRequiredString(req.body?.verificationCode);

  if (!phoneNumber) {
    return res.status(400).json({
      status: 400,
      message: '전화번호를 입력해주세요.',
    });
  }

  if (!verificationCode) {
    return res.status(400).json({
      status: 400,
      message: '인증번호를 입력해주세요.',
    });
  }

  try {
    const data = await updatePhoneNumberWithVerification(
      userId,
      phoneNumber,
      verificationCode,
    );

    return res.status(200).json({
      status: 200,
      message: '전화번호 수정 성공',
      data,
    });
  } catch (error) {
    const status = getErrorStatus(error);

    if (status === 400 || status === 404 || status === 502) {
      return res.status(status).json({
        status,
        message: error.message,
      });
    }

    if (status === 500 && error.message === '전화번호 인증 서비스 설정이 누락되었습니다.') {
      return res.status(500).json({
        status: 500,
        message: error.message,
      });
    }

    return res.status(500).json({
      status: 500,
      message: '전화번호 수정 중 서버 오류가 발생했습니다.',
    });
  }
};

const requestPhoneVerificationController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  const phoneNumber = normalizeRequiredString(req.body?.phoneNumber);

  if (!phoneNumber) {
    return res.status(400).json({
      status: 400,
      message: '전화번호를 입력해주세요.',
    });
  }

  try {
    const data = await requestPhoneVerification(userId, phoneNumber);

    return res.status(200).json({
      status: 200,
      message: '전화번호 인증 요청이 생성되었습니다.',
      data,
    });
  } catch (error) {
    const status = getErrorStatus(error);

    if (status === 400) {
      return res.status(400).json({
        status: 400,
        message: error.message,
      });
    }

    return res.status(500).json({
      status: 500,
      message: '전화번호 인증 요청 생성 중 서버 오류가 발생했습니다.',
    });
  }
};

const updateProfileImageController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  if (!req.file) {
    return res.status(400).json({
      status: 400,
      message: '프로필 이미지 파일을 첨부해주세요.',
    });
  }

  try {
    const data = await updateProfileImage(userId, req.file);

    return res.status(200).json({
      status: 200,
      message: '프로필 이미지 수정 성공',
      data,
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '프로필 이미지 수정 중 서버 오류가 발생했습니다.',
    });
  }
};

const changeMyPasswordController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  const currentPassword = typeof req.body?.currentPassword === 'string'
    ? req.body.currentPassword
    : '';
  const newPassword = typeof req.body?.newPassword === 'string'
    ? req.body.newPassword
    : '';

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      status: 400,
      message: '현재 비밀번호와 새 비밀번호를 입력해주세요.',
    });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({
      status: 400,
      message: '새 비밀번호는 8자 이상이어야 합니다.',
    });
  }

  try {
    await changeMyPassword(userId, currentPassword, newPassword);

    return res.status(200).json({
      status: 200,
      message: '비밀번호 변경 성공',
    });
  } catch (error) {
    const status = getErrorStatus(error);

    if (status === 400 || status === 401 || status === 404) {
      return res.status(status).json({
        status,
        message: error.message,
      });
    }

    return res.status(500).json({
      status: 500,
      message: '비밀번호 변경 중 서버 오류가 발생했습니다.',
    });
  }
};

module.exports = {
  getMyProfileController,
  getMyPageSummaryController,
  getMySulbtiController,
  saveMySulbtiController,
  getMyArchivesController,
  getMyArchiveDetailController,
  createMyArchiveController,
  updateMyArchiveController,
  deleteMyArchiveController,
  uploadArchiveImagesController,
  deleteArchiveImageController,
  getArchiveTagsController,
  checkNicknameController,
  updateNicknameController,
  updatePhoneNumberController,
  requestPhoneVerificationController,
  updateProfileImageController,
  changeMyPasswordController,
};
