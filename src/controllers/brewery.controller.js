const {
  createApplication,
  getApplications,
  getApplicationByUserId,
  approveApplication,
  rejectApplication,
  updateApprovedApplicationByUserId,
  getBreweryProfileByUserId,
  getBreweryDashboardBasicInfoByUserId,
  updateBreweryProfileByUserId,
  uploadBreweryProfileImageByUserId,
  getBreweryFundingSummaryByUserId,
  getBreweryDashboardFundingsByUserId,
  getBreweryFundingDeliveryByUserId,
  upsertBreweryFundingDeliveryByUserId,
  getBreweryNotificationsByUserId,
} = require('../services/brewery.service');
const { verifyAuthPhoneVerificationToken } = require('../services/auth-phone.service');

const APPLICATION_STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED']);

const getAuthenticatedUserId = (req) => {
  const userId = Number(req.user?.userId || req.user?.id);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
};

const sendError = (res, status, message, error) => {
  return res.status(status).json({
    status,
    message,
    error,
  });
};

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const parsePositiveIntegerParam = (value, name) => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    const error = new Error(`${name} 값이 올바르지 않습니다.`);
    error.statusCode = 400;
    error.detail = `${name}는 1 이상의 정수여야 합니다.`;
    throw error;
  }

  return parsed;
};

const getOptionalString = (body, key) => {
  if (!Object.prototype.hasOwnProperty.call(body, key)) {
    return undefined;
  }

  if (body[key] === null) {
    return null;
  }

  return typeof body[key] === 'string' ? body[key].trim() : String(body[key]).trim();
};

const getOptionalNullableString = (body, key) => {
  const value = getOptionalString(body, key);

  if (value === undefined) {
    return undefined;
  }

  return value === '' ? null : value;
};

const getOptionalEstablishedYear = (body) => {
  if (!Object.prototype.hasOwnProperty.call(body, 'establishedYear')) {
    return undefined;
  }

  if (body.establishedYear === null || body.establishedYear === '') {
    return null;
  }

  const year = Number(body.establishedYear);
  const currentYear = new Date().getFullYear();

  if (!Number.isInteger(year) || year < 1000 || year > currentYear) {
    const error = new Error('설립연도 입력값이 올바르지 않습니다.');
    error.statusCode = 400;
    error.detail = `establishedYear는 1000부터 ${currentYear} 사이의 정수여야 합니다.`;
    throw error;
  }

  return year;
};

const parsePaginationQuery = (query = {}) => {
  const page = query.page === undefined ? 0 : Number(query.page);
  const size = query.size === undefined ? 10 : Number(query.size);

  if (
    !Number.isInteger(page) ||
    !Number.isInteger(size) ||
    page < 0 ||
    size <= 0 ||
    size > 100
  ) {
    const error = new Error('페이지 요청값이 올바르지 않습니다.');
    error.statusCode = 400;
    error.detail = 'page는 0 이상의 정수, size는 1부터 100 사이의 정수여야 합니다.';
    throw error;
  }

  return { page, size };
};

const getMyBreweryProfile = async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return sendError(res, 401, '로그인이 필요합니다.', 'JWT payload의 userId가 없습니다.');
  }

  try {
    const profile = await getBreweryProfileByUserId(userId);

    return res.status(200).json(profile);
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '양조장 프로필 조회에 실패했습니다.',
      error.detail || error.message,
    );
  }
};

const getMyBreweryDashboardBasicInfo = async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return sendError(res, 401, '로그인이 필요합니다.', 'JWT payload의 userId가 없습니다.');
  }

  try {
    const basicInfo = await getBreweryDashboardBasicInfoByUserId(userId);

    return res.status(200).json(basicInfo);
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '양조장 대시보드 기본 정보 조회에 실패했습니다.',
      error.detail || error.message,
    );
  }
};

const updateMyBreweryProfile = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  const body = req.body || {};

  if (!userId) {
    return sendError(res, 401, '로그인이 필요합니다.', 'JWT payload의 userId가 없습니다.');
  }

  let establishedYear;

  try {
    establishedYear = getOptionalEstablishedYear(body);
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 400,
      error.message,
      error.detail || error.message,
    );
  }

  try {
    const profile = await updateBreweryProfileByUserId({
      userId,
      profile: {
        profileImageUrl: getOptionalNullableString(body, 'profileImageUrl'),
        breweryName: getOptionalNullableString(body, 'breweryName'),
        oneLineIntroduction: getOptionalNullableString(body, 'oneLineIntroduction'),
        shortIntroduction: getOptionalNullableString(body, 'shortIntroduction'),
        brandStory: getOptionalNullableString(body, 'brandStory'),
        history: getOptionalNullableString(body, 'history'),
        establishedYear,
        representativeName: getOptionalNullableString(body, 'representativeName'),
        address: getOptionalNullableString(body, 'address'),
        email: getOptionalNullableString(body, 'email'),
      },
    });

    return res.status(200).json(profile);
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '양조장 프로필 수정에 실패했습니다.',
      error.detail || error.message,
    );
  }
};

const getUploadedProfileImageFile = (req) => {
  if (req.file) {
    return req.file;
  }

  if (!req.files || typeof req.files !== 'object') {
    return null;
  }

  const fileGroups = [
    req.files.image,
    req.files.profileImage,
    req.files.file,
  ];

  for (const group of fileGroups) {
    if (Array.isArray(group) && group[0]) {
      return group[0];
    }
  }

  return null;
};

const uploadMyBreweryProfileImage = async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return sendError(res, 401, '로그인이 필요합니다.', 'JWT payload의 userId가 없습니다.');
  }

  try {
    const result = await uploadBreweryProfileImageByUserId({
      userId,
      file: getUploadedProfileImageFile(req),
    });

    return res.status(200).json(result);
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '양조장 프로필 이미지 업로드에 실패했습니다.',
      error.detail || error.message,
    );
  }
};

const getMyBreweryDashboardFundingSummary = async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return sendError(res, 401, '로그인이 필요합니다.', 'JWT payload의 userId가 없습니다.');
  }

  try {
    const summary = await getBreweryFundingSummaryByUserId(userId);

    return res.status(200).json(summary);
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '양조장 대시보드 펀딩 현황 조회에 실패했습니다.',
      error.detail || error.message,
    );
  }
};

const getMyBreweryDashboardFundings = async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return sendError(res, 401, '로그인이 필요합니다.', 'JWT payload의 userId가 없습니다.');
  }

  let pagination;

  try {
    pagination = parsePaginationQuery(req.query);
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 400,
      error.message,
      error.detail || error.message,
    );
  }

  try {
    const result = await getBreweryDashboardFundingsByUserId({
      userId,
      status: req.query.status,
      page: pagination.page,
      size: pagination.size,
    });

    return res.status(200).json(result);
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '양조장 대시보드 펀딩 목록 조회에 실패했습니다.',
      error.detail || error.message,
    );
  }
};

const getMyBreweryDashboardFundingDelivery = async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return sendError(res, 401, '로그인이 필요합니다.', 'JWT payload의 userId가 없습니다.');
  }

  let fundingId;

  try {
    fundingId = parsePositiveIntegerParam(req.params.fundingId, 'fundingId');
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 400,
      error.message,
      error.detail || error.message,
    );
  }

  try {
    const delivery = await getBreweryFundingDeliveryByUserId({
      userId,
      fundingId,
    });

    return res.status(200).json(delivery);
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '펀딩 배송 정보 조회에 실패했습니다.',
      error.detail || error.message,
    );
  }
};

const upsertMyBreweryDashboardFundingDelivery = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  const body = req.body || {};

  if (!userId) {
    return sendError(res, 401, '로그인이 필요합니다.', 'JWT payload의 userId가 없습니다.');
  }

  let fundingId;

  try {
    fundingId = parsePositiveIntegerParam(req.params.fundingId, 'fundingId');
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 400,
      error.message,
      error.detail || error.message,
    );
  }

  const courier = normalizeString(body.courier);
  const trackingNumber = normalizeString(body.trackingNumber || body.tracking_number);

  if (!courier || !trackingNumber) {
    return sendError(
      res,
      400,
      '배송 정보 입력값이 올바르지 않습니다.',
      'courier, trackingNumber는 필수입니다.',
    );
  }

  try {
    const delivery = await upsertBreweryFundingDeliveryByUserId({
      userId,
      fundingId,
      courier,
      trackingNumber,
    });

    return res.status(200).json(delivery);
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '펀딩 배송 정보 저장에 실패했습니다.',
      error.detail || error.message,
    );
  }
};

const getMyBreweryDashboardNotifications = async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return sendError(res, 401, '로그인이 필요합니다.', 'JWT payload의 userId가 없습니다.');
  }

  try {
    const notifications = await getBreweryNotificationsByUserId(userId);
    const unreadCount = notifications.filter((notification) => !notification.isRead).length;

    return res.status(200).json({
      notifications,
      content: notifications,
      unreadCount,
    });
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '양조장 대시보드 알림 목록 조회에 실패했습니다.',
      error.detail || error.message,
    );
  }
};

const createBreweryApplication = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  const {
    businessNumber,
    licenseNumber,
    breweryName,
    businessAddress,
    businessAddressDetail,
    location,
    phoneNumber,
    phoneVerificationToken,
    documentUrl,
    documentKey,
  } = req.body || {};
  const normalizedBusinessNumber = normalizeString(businessNumber || licenseNumber);
  const normalizedBreweryName = normalizeString(breweryName);
  const normalizedBusinessAddress = normalizeString(businessAddress || location);
  const normalizedBusinessAddressDetail = normalizeString(businessAddressDetail) || null;
  const normalizedPhoneNumber = normalizeString(phoneNumber);
  const normalizedPhoneVerificationToken = normalizeString(phoneVerificationToken);
  const normalizedDocumentUrl = normalizeString(documentUrl);
  const normalizedDocumentKey = normalizeString(documentKey) || null;

  if (!userId) {
    return sendError(res, 401, '로그인이 필요합니다.', 'JWT payload의 userId가 없습니다.');
  }

  if (
    !normalizedBusinessNumber
    || !normalizedBreweryName
    || !normalizedBusinessAddress
    || !normalizedPhoneNumber
    || !normalizedPhoneVerificationToken
  ) {
    return sendError(
      res,
      400,
      '양조장 인증 신청 입력값이 올바르지 않습니다.',
      'businessNumber, breweryName, businessAddress, phoneNumber, phoneVerificationToken은 필수입니다.',
    );
  }

  if (!req.file && !normalizedDocumentUrl) {
    return sendError(
      res,
      400,
      '사업자등록증 파일을 첨부해주세요.',
      'businessLicense는 필수입니다.',
    );
  }

  try {
    let phoneVerification;

    try {
      phoneVerification = await verifyAuthPhoneVerificationToken(
        normalizedPhoneNumber,
        normalizedPhoneVerificationToken,
      );
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({
          status: 400,
          message: '전화번호 인증이 필요합니다.',
        });
      }

      throw error;
    }

    if (!phoneVerification.isValid) {
      return res.status(400).json({
        status: 400,
        message: '전화번호 인증이 필요합니다.',
      });
    }

    const application = await createApplication({
      userId,
      breweryName: normalizedBreweryName,
      licenseNumber: normalizedBusinessNumber,
      location: normalizedBusinessAddress,
      businessAddressDetail: normalizedBusinessAddressDetail,
      phoneNumber: phoneVerification.phoneNumber,
      businessLicenseFile: req.file,
      documentUrl: normalizedDocumentUrl,
      documentKey: normalizedDocumentKey,
    });

    return res.status(201).json({
      status: 201,
      message: '양조장 인증 신청 성공',
      data: application,
    });
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

    return res.status(200).json({
      status: 200,
      message: '내 양조장 인증 신청 조회 성공',
      data: application,
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(200).json({
        status: 200,
        message: '양조장 인증 신청 내역이 없습니다.',
        data: null,
      });
    }

    return sendError(
      res,
      error.statusCode || 500,
      error.message || '양조장 인증 신청 조회에 실패했습니다.',
      error.detail || error.message,
    );
  }
};

const updateMyApprovedBreweryApplication = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  const body = req.body || {};

  if (!userId) {
    return sendError(res, 401, '로그인이 필요합니다.', 'JWT payload의 userId가 없습니다.');
  }

  const breweryName = getOptionalString(body, 'breweryName');
  const licenseNumber = getOptionalString(body, 'licenseNumber');
  const locationValue = getOptionalString(body, 'location');
  const documentUrlValue = getOptionalString(body, 'documentUrl');
  const documentKeyValue = getOptionalString(body, 'documentKey');
  const location = locationValue === '' ? null : locationValue;
  const documentUrl = documentUrlValue === '' ? null : documentUrlValue;
  const documentKey = documentKeyValue === '' ? null : documentKeyValue;

  if (breweryName === '' || licenseNumber === '') {
    return sendError(
      res,
      400,
      '양조장 정보 수정 입력값이 올바르지 않습니다.',
      'breweryName, licenseNumber는 빈 문자열로 수정할 수 없습니다.',
    );
  }

  try {
    const application = await updateApprovedApplicationByUserId({
      userId,
      breweryName,
      licenseNumber,
      location,
      documentUrl,
      documentKey,
    });

    return res.status(200).json({
      status: 200,
      message: '승인된 양조장 정보가 수정되었습니다.',
      data: application,
    });
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '승인된 양조장 정보 수정에 실패했습니다.',
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
  getMyBreweryProfile,
  getMyBreweryDashboardBasicInfo,
  updateMyBreweryProfile,
  uploadMyBreweryProfileImage,
  getMyBreweryDashboardFundingSummary,
  getMyBreweryDashboardFundings,
  getMyBreweryDashboardFundingDelivery,
  upsertMyBreweryDashboardFundingDelivery,
  getMyBreweryDashboardNotifications,
  createBreweryApplication,
  getBreweryApplications,
  getMyBreweryApplication,
  updateMyApprovedBreweryApplication,
  approveBreweryApplication,
  rejectBreweryApplication,
};
