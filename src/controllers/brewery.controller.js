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
    const error = new Error(`${name} 媛믪씠 ?щ컮瑜댁? ?딆뒿?덈떎.`);
    error.statusCode = 400;
    error.detail = `${name}??1 ?댁긽???뺤닔?ъ빞 ?⑸땲??`;
    throw error;
  }

  return parsed;
};

const normalizeAccountNumber = (value) => normalizeString(value).replace(/\D/g, '');

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

const verifyBreweryAccount = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  const { bankName, accountNumber, accountHolder } = req.body || {};
  const normalizedBankName = normalizeString(bankName);
  const normalizedAccountNumber = normalizeAccountNumber(accountNumber);
  const normalizedAccountHolder = normalizeString(accountHolder);

  if (!userId) {
    return sendError(res, 401, '로그인이 필요합니다.', 'JWT payload에 userId가 없습니다.');
  }

  if (!normalizedBankName || !normalizedAccountNumber || !normalizedAccountHolder) {
    return res.status(400).json({
      verified: false,
      message: '입금계좌 정보를 모두 입력해주세요.',
    });
  }

  if (normalizedAccountNumber.length < 8) {
    return res.status(400).json({
      verified: false,
      message: '계좌번호는 숫자 8자리 이상이어야 합니다.',
    });
  }

  // MVP simple verification. Replace this with a real bank account owner check before production.
  return res.status(200).json({
    verified: true,
    bankName: normalizedBankName,
    accountNumber: normalizedAccountNumber,
    accountHolder: normalizedAccountHolder,
    message: '입금계좌 인증이 완료되었습니다.',
  });
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
    const error = new Error('?ㅻ┰?곕룄 ?낅젰媛믪씠 ?щ컮瑜댁? ?딆뒿?덈떎.');
    error.statusCode = 400;
    error.detail = `establishedYear??1000遺??${currentYear} ?ъ씠???뺤닔?ъ빞 ?⑸땲??`;
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
    const error = new Error('?섏씠吏 ?붿껌媛믪씠 ?щ컮瑜댁? ?딆뒿?덈떎.');
    error.statusCode = 400;
    error.detail = 'page??0 ?댁긽???뺤닔, size??1遺??100 ?ъ씠???뺤닔?ъ빞 ?⑸땲??';
    throw error;
  }

  return { page, size };
};

const getMyBreweryProfile = async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return sendError(res, 401, '濡쒓렇?몄씠 ?꾩슂?⑸땲??', 'JWT payload??userId媛 ?놁뒿?덈떎.');
  }

  try {
    const profile = await getBreweryProfileByUserId(userId);

    return res.status(200).json(profile);
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '?묒“???꾨줈??議고쉶???ㅽ뙣?덉뒿?덈떎.',
      error.detail || error.message,
    );
  }
};

const getMyBreweryDashboardBasicInfo = async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return sendError(res, 401, '濡쒓렇?몄씠 ?꾩슂?⑸땲??', 'JWT payload??userId媛 ?놁뒿?덈떎.');
  }

  try {
    const basicInfo = await getBreweryDashboardBasicInfoByUserId(userId);

    return res.status(200).json(basicInfo);
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '?묒“????쒕낫??湲곕낯 ?뺣낫 議고쉶???ㅽ뙣?덉뒿?덈떎.',
      error.detail || error.message,
    );
  }
};

const updateMyBreweryProfile = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  const body = req.body || {};

  if (!userId) {
    return sendError(res, 401, '濡쒓렇?몄씠 ?꾩슂?⑸땲??', 'JWT payload??userId媛 ?놁뒿?덈떎.');
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
      error.message || '?묒“???꾨줈???섏젙???ㅽ뙣?덉뒿?덈떎.',
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
    return sendError(res, 401, '濡쒓렇?몄씠 ?꾩슂?⑸땲??', 'JWT payload??userId媛 ?놁뒿?덈떎.');
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
      error.message || '?묒“???꾨줈???대?吏 ?낅줈?쒖뿉 ?ㅽ뙣?덉뒿?덈떎.',
      error.detail || error.message,
    );
  }
};

const getMyBreweryDashboardFundingSummary = async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return sendError(res, 401, '濡쒓렇?몄씠 ?꾩슂?⑸땲??', 'JWT payload??userId媛 ?놁뒿?덈떎.');
  }

  try {
    const summary = await getBreweryFundingSummaryByUserId(userId);

    return res.status(200).json(summary);
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '?묒“????쒕낫??????꾪솴 議고쉶???ㅽ뙣?덉뒿?덈떎.',
      error.detail || error.message,
    );
  }
};

const getMyBreweryDashboardFundings = async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return sendError(res, 401, '濡쒓렇?몄씠 ?꾩슂?⑸땲??', 'JWT payload??userId媛 ?놁뒿?덈떎.');
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
      error.message || '?묒“????쒕낫?????紐⑸줉 議고쉶???ㅽ뙣?덉뒿?덈떎.',
      error.detail || error.message,
    );
  }
};

const getMyBreweryDashboardFundingDelivery = async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return sendError(res, 401, '濡쒓렇?몄씠 ?꾩슂?⑸땲??', 'JWT payload??userId媛 ?놁뒿?덈떎.');
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
      error.message || '???諛곗넚 ?뺣낫 議고쉶???ㅽ뙣?덉뒿?덈떎.',
      error.detail || error.message,
    );
  }
};

const upsertMyBreweryDashboardFundingDelivery = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  const body = req.body || {};

  if (!userId) {
    return sendError(res, 401, '濡쒓렇?몄씠 ?꾩슂?⑸땲??', 'JWT payload??userId媛 ?놁뒿?덈떎.');
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
      '諛곗넚 ?뺣낫 ?낅젰媛믪씠 ?щ컮瑜댁? ?딆뒿?덈떎.',
      'courier, trackingNumber???꾩닔?낅땲??',
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
      error.message || '???諛곗넚 ?뺣낫 ??μ뿉 ?ㅽ뙣?덉뒿?덈떎.',
      error.detail || error.message,
    );
  }
};

const getMyBreweryDashboardNotifications = async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return sendError(res, 401, '濡쒓렇?몄씠 ?꾩슂?⑸땲??', 'JWT payload??userId媛 ?놁뒿?덈떎.');
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
      error.message || '?묒“????쒕낫???뚮┝ 紐⑸줉 議고쉶???ㅽ뙣?덉뒿?덈떎.',
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
    return sendError(res, 401, '濡쒓렇?몄씠 ?꾩슂?⑸땲??', 'JWT payload??userId媛 ?놁뒿?덈떎.');
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
      '?묒“???몄쬆 ?좎껌 ?낅젰媛믪씠 ?щ컮瑜댁? ?딆뒿?덈떎.',
      'businessNumber, breweryName, businessAddress, phoneNumber, phoneVerificationToken? ?꾩닔?낅땲??',
    );
  }

  if (!req.file && !normalizedDocumentUrl) {
    return sendError(
      res,
      400,
      '?ъ뾽?먮벑濡앹쬆 ?뚯씪??泥⑤??댁＜?몄슂.',
      'businessLicense???꾩닔?낅땲??',
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
          message: '?꾪솕踰덊샇 ?몄쬆???꾩슂?⑸땲??',
        });
      }

      throw error;
    }

    if (!phoneVerification.isValid) {
      return res.status(400).json({
        status: 400,
        message: '?꾪솕踰덊샇 ?몄쬆???꾩슂?⑸땲??',
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
      message: '?묒“???몄쬆 ?좎껌 ?깃났',
      data: application,
    });
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '?묒“???몄쬆 ?좎껌 ?앹꽦???ㅽ뙣?덉뒿?덈떎.',
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
    return sendError(res, 401, '濡쒓렇?몄씠 ?꾩슂?⑸땲??', 'JWT payload??userId媛 ?놁뒿?덈떎.');
  }

  if (normalizedStatus && !APPLICATION_STATUSES.has(normalizedStatus)) {
    return sendError(
      res,
      400,
      '?좎껌 ?곹깭 媛믪씠 ?щ컮瑜댁? ?딆뒿?덈떎.',
      'status??PENDING, APPROVED, REJECTED 以??섎굹?ъ빞 ?⑸땲??',
    );
  }

  try {
    const applications = await getApplications({ status: normalizedStatus });

    return res.status(200).json({
      status: 200,
      message: '?묒“???몄쬆 ?좎껌 紐⑸줉 議고쉶 ?깃났',
      data: applications,
    });
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '?묒“???몄쬆 ?좎껌 紐⑸줉 議고쉶???ㅽ뙣?덉뒿?덈떎.',
      error.detail || error.message,
    );
  }
};

const getMyBreweryApplication = async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return sendError(res, 401, '濡쒓렇?몄씠 ?꾩슂?⑸땲??', 'JWT payload??userId媛 ?놁뒿?덈떎.');
  }

  try {
    const application = await getApplicationByUserId(userId);

    return res.status(200).json({
      status: 200,
      message: '???묒“???몄쬆 ?좎껌 議고쉶 ?깃났',
      data: application,
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(200).json({
        status: 200,
        message: '?묒“???몄쬆 ?좎껌 ?댁뿭???놁뒿?덈떎.',
        data: null,
      });
    }

    return sendError(
      res,
      error.statusCode || 500,
      error.message || '?묒“???몄쬆 ?좎껌 議고쉶???ㅽ뙣?덉뒿?덈떎.',
      error.detail || error.message,
    );
  }
};

const updateMyApprovedBreweryApplication = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  const body = req.body || {};

  if (!userId) {
    return sendError(res, 401, '濡쒓렇?몄씠 ?꾩슂?⑸땲??', 'JWT payload??userId媛 ?놁뒿?덈떎.');
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
      '?묒“???뺣낫 ?섏젙 ?낅젰媛믪씠 ?щ컮瑜댁? ?딆뒿?덈떎.',
      'breweryName, licenseNumber??鍮?臾몄옄?대줈 ?섏젙?????놁뒿?덈떎.',
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
      message: '?뱀씤???묒“???뺣낫媛 ?섏젙?섏뿀?듬땲??',
      data: application,
    });
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '?뱀씤???묒“???뺣낫 ?섏젙???ㅽ뙣?덉뒿?덈떎.',
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
      '?묒“???몄쬆 ?좎껌 ID媛 ?щ컮瑜댁? ?딆뒿?덈떎.',
      'applicationId???묒쓽 ?뺤닔?ъ빞 ?⑸땲??',
    );
  }

  try {
    // TODO: Restrict this endpoint to ADMIN users after admin authorization is added.
    const result = await approveApplication(applicationId);

    return res.status(200).json({
      ...result,
      message: '?묒“???몄쬆???뱀씤?섏뿀?듬땲?? 湲곗〈 accessToken?먮뒗 ?댁쟾 role???ㅼ뼱?덉쓣 ???덉쑝誘濡??ㅼ떆 濡쒓렇?명빐??role=BREWERY媛 諛섏쁺?⑸땲??',
    });
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '?묒“???몄쬆 ?뱀씤???ㅽ뙣?덉뒿?덈떎.',
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
      '?묒“???몄쬆 ?좎껌 ID媛 ?щ컮瑜댁? ?딆뒿?덈떎.',
      'applicationId???묒쓽 ?뺤닔?ъ빞 ?⑸땲??',
    );
  }

  if (!normalizedRejectReason) {
    return sendError(
      res,
      400,
      '嫄곗젅 ?ъ쑀媛 ?꾩슂?⑸땲??',
      'rejectReason? ?꾩닔?낅땲??',
    );
  }

  try {
    const application = await rejectApplication({
      applicationId,
      rejectReason: normalizedRejectReason,
    });

    return res.status(200).json({
      status: 200,
      message: '?묒“???몄쬆 ?좎껌??嫄곗젅?섏뿀?듬땲??',
      data: application,
    });
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '?묒“???몄쬆 ?좎껌 嫄곗젅???ㅽ뙣?덉뒿?덈떎.',
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
  verifyBreweryAccount,
  createBreweryApplication,
  getBreweryApplications,
  getMyBreweryApplication,
  updateMyApprovedBreweryApplication,
  approveBreweryApplication,
  rejectBreweryApplication,
};
