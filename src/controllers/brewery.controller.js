const {
  createApplication,
  getApplicationByUserId,
  approveApplication,
} = require('../services/brewery.service');

const getAuthenticatedUserId = (req) => {
  const userId = Number(req.user?.userId || req.user?.id);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
};

const sendError = (res, status, message, error) => {
  return res.status(status).json({
    message,
    error,
  });
};

const createBreweryApplication = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  const { breweryName, licenseNumber, location } = req.body;
  const normalizedBreweryName = typeof breweryName === 'string' ? breweryName.trim() : '';
  const normalizedLicenseNumber = typeof licenseNumber === 'string' ? licenseNumber.trim() : '';
  const normalizedLocation = typeof location === 'string' && location.trim() ? location.trim() : null;

  if (!userId) {
    return sendError(res, 401, '로그인이 필요합니다.', 'JWT payload의 userId가 없습니다.');
  }

  if (!normalizedBreweryName || !normalizedLicenseNumber) {
    return sendError(
      res,
      400,
      '양조장 인증 신청 입력값이 올바르지 않습니다.',
      'breweryName, licenseNumber는 필수입니다.',
    );
  }

  try {
    const application = await createApplication({
      userId,
      breweryName: normalizedBreweryName,
      licenseNumber: normalizedLicenseNumber,
      location: normalizedLocation,
    });

    return res.status(201).json(application);
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '양조장 인증 신청 생성에 실패했습니다.',
      error.detail || error.message,
    );
  }
};

const getMyBreweryApplication = async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return sendError(res, 401, '로그인이 필요합니다.', 'JWT payload의 userId가 없습니다.');
  }

  try {
    const application = await getApplicationByUserId(userId);
    return res.status(200).json(application);
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '양조장 인증 신청 조회에 실패했습니다.',
      error.detail || error.message,
    );
  }
};

const approveBreweryApplication = async (req, res) => {
  const applicationId = Number(req.params.applicationId);

  if (!Number.isInteger(applicationId) || applicationId <= 0) {
    return sendError(
      res,
      400,
      '양조장 인증 신청 ID가 올바르지 않습니다.',
      'applicationId는 양의 정수여야 합니다.',
    );
  }

  try {
    // TODO: Restrict this endpoint to ADMIN users after admin authorization is added.
    const result = await approveApplication(applicationId);

    return res.status(200).json({
      ...result,
      message: '양조장 인증이 승인되었습니다. 기존 accessToken에는 이전 role이 들어있을 수 있으므로 다시 로그인해야 role=BREWERY가 반영됩니다.',
    });
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '양조장 인증 승인에 실패했습니다.',
      error.detail || error.message,
    );
  }
};

module.exports = {
  createBreweryApplication,
  getMyBreweryApplication,
  approveBreweryApplication,
};
