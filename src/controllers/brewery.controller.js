const {
  createApplication,
  getApplications,
  getApplicationByUserId,
  approveApplication,
  rejectApplication,
} = require('../services/brewery.service');

const APPLICATION_STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED']);

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
  const { breweryName, licenseNumber, location, documentUrl, documentKey } = req.body || {};
  const normalizedBreweryName = typeof breweryName === 'string' ? breweryName.trim() : '';
  const normalizedLicenseNumber = typeof licenseNumber === 'string' ? licenseNumber.trim() : '';
  const normalizedLocation = typeof location === 'string' && location.trim() ? location.trim() : null;
  const normalizedDocumentUrl = typeof documentUrl === 'string' ? documentUrl.trim() : '';
  const normalizedDocumentKey = typeof documentKey === 'string' && documentKey.trim() ? documentKey.trim() : null;

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

  if (!normalizedDocumentUrl) {
    return sendError(
      res,
      400,
      '증빙서류 파일 URL이 필요합니다.',
      'documentUrl은 필수입니다.',
    );
  }

  try {
    const application = await createApplication({
      userId,
      breweryName: normalizedBreweryName,
      licenseNumber: normalizedLicenseNumber,
      location: normalizedLocation,
      documentUrl: normalizedDocumentUrl,
      documentKey: normalizedDocumentKey,
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

const getBreweryApplications = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  const { status } = req.query;
  const normalizedStatus = typeof status === 'string' && status.trim()
    ? status.trim().toUpperCase()
    : null;

  if (!userId) {
    return sendError(res, 401, '로그인이 필요합니다.', 'JWT payload에 userId가 없습니다.');
  }

  if (normalizedStatus && !APPLICATION_STATUSES.has(normalizedStatus)) {
    return sendError(
      res,
      400,
      '신청 상태 값이 올바르지 않습니다.',
      'status는 PENDING, APPROVED, REJECTED 중 하나여야 합니다.',
    );
  }

  try {
    const applications = await getApplications({ status: normalizedStatus });

    return res.status(200).json({
      status: 200,
      message: '양조장 인증 신청 목록 조회 성공',
      data: applications,
    });
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '양조장 인증 신청 목록 조회에 실패했습니다.',
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

const rejectBreweryApplication = async (req, res) => {
  const applicationId = Number(req.params.applicationId);
  const { rejectReason } = req.body || {};
  const normalizedRejectReason = typeof rejectReason === 'string' ? rejectReason.trim() : '';

  if (!Number.isInteger(applicationId) || applicationId <= 0) {
    return sendError(
      res,
      400,
      '양조장 인증 신청 ID가 올바르지 않습니다.',
      'applicationId는 양의 정수여야 합니다.',
    );
  }

  if (!normalizedRejectReason) {
    return sendError(
      res,
      400,
      '거절 사유가 필요합니다.',
      'rejectReason은 필수입니다.',
    );
  }

  try {
    const application = await rejectApplication({
      applicationId,
      rejectReason: normalizedRejectReason,
    });

    return res.status(200).json({
      status: 200,
      message: '양조장 인증 신청이 거절되었습니다.',
      data: application,
    });
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '양조장 인증 신청 거절에 실패했습니다.',
      error.detail || error.message,
    );
  }
};

module.exports = {
  createBreweryApplication,
  getBreweryApplications,
  getMyBreweryApplication,
  approveBreweryApplication,
  rejectBreweryApplication,
};
