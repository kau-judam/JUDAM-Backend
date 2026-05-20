const {
  getMyProfile,
  checkNickname,
  updateNickname,
  updatePhoneNumber,
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

  if (!phoneNumber) {
    return res.status(400).json({
      status: 400,
      message: '전화번호를 입력해주세요.',
    });
  }

  try {
    const data = await updatePhoneNumber(userId, phoneNumber);

    return res.status(200).json({
      status: 200,
      message: '전화번호 수정 성공',
      data,
    });
  } catch (error) {
    return sendErrorResponse(res, error, '전화번호 수정 중 서버 오류가 발생했습니다.');
  }
};

module.exports = {
  getMyProfileController,
  checkNicknameController,
  updateNicknameController,
  updatePhoneNumberController,
};
