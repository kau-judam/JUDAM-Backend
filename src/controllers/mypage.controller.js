const {
  getMyProfile,
  checkNickname,
  updateNickname,
  updateProfileImage,
  changeMyPassword,
  requestPhoneVerification,
  updatePhoneNumberWithVerification,
  getMyPageSummary,
  getMyBadges,
  getMySulbti,
  getMySulbtiShareLink,
  saveMySulbti,
  getMyArchives,
  getMyArchiveDetail,
  createMyArchive,
  updateMyArchive,
  deleteMyArchive,
  getArchiveTags,
  uploadArchiveImages,
  deleteArchiveImage,
  normalizeArchiveFormPayload,
  normalizeArchiveDeleteImageIds,
  getParticipatedFundings,
  getParticipatedFundingOrderDetail,
  getMyFundingReview,
  getMyActivityInterests,
  getMyActivityComments,
  getMyActivityQna,
  getMyActivityFundingJournalComments,
} = require('../services/mypage.service');

const UNAUTHORIZED_RESPONSE = {
  status: 401,
  message: '?좏슚?섏? ?딄굅??留뚮즺???좏겙?낅땲??',
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

const normalizeShareBaseUrl = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.toLowerCase() === 'null' || normalized.toLowerCase() === 'undefined') {
    return null;
  }
  return normalized.replace(/\/+$/, '');
};

const buildPublicShareBaseUrl = (req) => {
  const requestBaseUrl = normalizeShareBaseUrl(`${req.protocol}://${req.get('host')}`);
  return (
    normalizeShareBaseUrl(process.env.PUBLIC_WEB_BASE_URL) ||
    normalizeShareBaseUrl(process.env.FRONTEND_BASE_URL) ||
    requestBaseUrl
  );
};

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
      message: '???뺣낫 議고쉶 ?깃났',
      data,
    });
  } catch (error) {
    return sendErrorResponse(res, error, '???뺣낫 議고쉶 以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.');
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
      message: '留덉씠?섏씠吏 硫붿씤 ?붿빟 議고쉶 ?깃났',
      data,
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '留덉씠?섏씠吏 硫붿씤 ?붿빟 議고쉶 以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
    });
  }
};

const getMyBadgesController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    const data = await getMyBadges(userId);

    return res.status(200).json({
      status: 200,
      message: '留덉씠?섏씠吏 諭껋? 紐⑸줉 議고쉶 ?깃났',
      data,
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '留덉씠?섏씠吏 諭껋? 紐⑸줉 議고쉶 以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
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
      message: data.hasResult ? '?잹TI 寃곌낵 議고쉶 ?깃났' : '?잹TI 寃곌낵媛 ?놁뒿?덈떎.',
      data,
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '?잹TI 寃곌낵 議고쉶 以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
    });
  }
};


const getMySulbtiShareLinkController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);
  if (!userId) {
    return;
  }

  try {
    await getMySulbtiShareLink(userId);
    const publicBaseUrl = buildPublicShareBaseUrl(req);
    const shareUrl = `${publicBaseUrl}/sulbti/result/${encodeURIComponent(String(userId))}`;

    return res.status(200).json({
      status: 200,
      message: '술BTI 공유 링크 생성 성공',
      data: {
        shareUrl,
      },
      shareUrl,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      status,
      message: status === 404 ? '술BTI 결과가 없습니다.' : (error.message || '술BTI 공유 링크 생성 중 서버 오류가 발생했습니다.'),
    });
  }
};
const saveMySulbtiController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    const isSurveyConvertRequest = req.body?.type === undefined && (
      Array.isArray(req.body)
      || Object.keys(req.body || {}).some((key) => /^q(?:[1-9]|1[0-9]|2[0-5])$/.test(key))
      || Object.prototype.hasOwnProperty.call(req.body || {}, 'answers')
      || Object.prototype.hasOwnProperty.call(req.body || {}, 'surveyResponses')
      || Object.prototype.hasOwnProperty.call(req.body || {}, 'responses')
    );
    const data = await saveMySulbti(userId, req.body);
    const status = isSurveyConvertRequest ? 200 : 201;

    return res.status(status).json({
      status,
      message: '?잹TI 寃곌낵 ????깃났',
      data,
    });
  } catch (error) {
    const status = getErrorStatus(error);

    if ([400, 500, 502, 504].includes(status)) {
      return res.status(status).json({
        status,
        message: error.message,
      });
    }

    return res.status(500).json({
      status: 500,
      message: '?잹TI 寃곌낵 ???以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
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
      message: '?꾩뭅?대툕 紐⑸줉 議고쉶 ?깃났',
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
      '?꾩뭅?대툕 紐⑸줉 議고쉶 以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
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
      message: '?꾩뭅?대툕 ?곸꽭 議고쉶 ?깃났',
      data,
    });
  } catch (error) {
    return sendArchiveErrorResponse(
      res,
      error,
      '?꾩뭅?대툕 ?곸꽭 議고쉶 以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
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
      message: '?꾩뭅?대툕 ?묒꽦 ?깃났',
      data,
    });
  } catch (error) {
    return sendArchiveErrorResponse(
      res,
      error,
      '?꾩뭅?대툕 ?묒꽦 以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
    );
  }
};

const createMyArchiveWithImagesController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    const payload = normalizeArchiveFormPayload(req.body);
    const archive = await createMyArchive(userId, payload);

    if (Array.isArray(req.files) && req.files.length > 0) {
      await uploadArchiveImages(userId, archive.archiveId, req.files);
    }

    const data = await getMyArchiveDetail(userId, archive.archiveId);
    if (archive.aiTasteUpdate) {
      data.aiTasteUpdate = archive.aiTasteUpdate;
    }

    return res.status(201).json({
      status: 201,
      message: '?꾩뭅?대툕 ?묒꽦 ?깃났',
      data,
    });
  } catch (error) {
    return sendArchiveErrorResponse(
      res,
      error,
      '?꾩뭅?대툕 ?묒꽦 以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
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
      message: '?꾩뭅?대툕 ?섏젙 ?깃났',
      data,
    });
  } catch (error) {
    return sendArchiveErrorResponse(
      res,
      error,
      '?꾩뭅?대툕 ?섏젙 以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
    );
  }
};

const updateMyArchiveWithImagesController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    const payload = normalizeArchiveFormPayload(req.body);
    const deleteImageIds = normalizeArchiveDeleteImageIds(req.body?.deleteImageIds);
    let aiTasteUpdate = null;

    if (Object.keys(payload).length > 0) {
      const updatedArchive = await updateMyArchive(userId, req.params.archiveId, payload);
      aiTasteUpdate = updatedArchive.aiTasteUpdate || null;
    }

    if (Array.isArray(deleteImageIds) && deleteImageIds.length > 0) {
      for (const imageId of deleteImageIds) {
        await deleteArchiveImage(userId, req.params.archiveId, imageId);
      }
    }

    if (Array.isArray(req.files) && req.files.length > 0) {
      await uploadArchiveImages(userId, req.params.archiveId, req.files);
    }

    const data = await getMyArchiveDetail(userId, req.params.archiveId);
    if (aiTasteUpdate) {
      data.aiTasteUpdate = aiTasteUpdate;
    }

    return res.status(200).json({
      status: 200,
      message: '?꾩뭅?대툕 ?섏젙 ?깃났',
      data,
    });
  } catch (error) {
    return sendArchiveErrorResponse(
      res,
      error,
      '?꾩뭅?대툕 ?섏젙 以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
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
      message: '?꾩뭅?대툕 ??젣 ?깃났',
    });
  } catch (error) {
    return sendArchiveErrorResponse(
      res,
      error,
      '?꾩뭅?대툕 ??젣 以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
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
      message: '?꾩뭅?대툕 ?대?吏 ?낅줈???깃났',
      data,
    });
  } catch (error) {
    return sendArchiveErrorResponse(
      res,
      error,
      '?꾩뭅?대툕 ?대?吏 ?낅줈??以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
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
      message: '?꾩뭅?대툕 ?대?吏 ??젣 ?깃났',
    });
  } catch (error) {
    return sendArchiveErrorResponse(
      res,
      error,
      '?꾩뭅?대툕 ?대?吏 ??젣 以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
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
      message: '?꾩뭅?대툕 ?쒓렇 紐⑸줉 議고쉶 ?깃났',
      data,
    });
  } catch (error) {
    return sendArchiveErrorResponse(
      res,
      error,
      '?꾩뭅?대툕 ?쒓렇 紐⑸줉 議고쉶 以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
    );
  }
};

const getParticipatedFundingsController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    const excludeArchived = req.query.excludeArchived === 'true';
    const data = await getParticipatedFundings(userId, { excludeArchived });

    return res.status(200).json({
      status: 200,
      message: '李몄뿬 ???紐⑸줉 議고쉶 ?깃났',
      data,
    });
  } catch (error) {
    return sendArchiveErrorResponse(
      res,
      error,
      '李몄뿬 ???紐⑸줉 議고쉶 以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
    );
  }
};

const getParticipatedFundingOrderDetailController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    const data = await getParticipatedFundingOrderDetail(userId, req.params.orderId);

    return res.status(200).json({
      status: 200,
      message: '주문/배송 상세 조회 성공',
      data,
    });
  } catch (error) {
    return sendArchiveErrorResponse(
      res,
      error,
      '주문/배송 상세 조회 중 서버 오류가 발생했습니다.',
    );
  }
};

const getMyFundingReviewController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    const data = await getMyFundingReview(userId, req.params.fundingId);

    return res.status(200).json({
      status: 200,
      message: data ? '????꾧린 議고쉶 ?깃났' : '遺덈윭???꾧린媛 ?놁뒿?덈떎.',
      data,
    });
  } catch (error) {
    return sendArchiveErrorResponse(
      res,
      error,
      '????꾧린 議고쉶 以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
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
      message: '닉네임 중복 확인 성공',
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

    if (status === 500 && error.message === '?꾪솕踰덊샇 ?몄쬆 ?쒕퉬???ㅼ젙???꾨씫?섏뿀?듬땲??') {
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
      message: '전화번호 인증 요청 성공',
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
      message: '전화번호 인증 요청 중 서버 오류가 발생했습니다.',
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
      message: '?꾨줈???대?吏 ?뚯씪??泥⑤??댁＜?몄슂.',
    });
  }

  try {
    const data = await updateProfileImage(userId, req.file);

    return res.status(200).json({
      status: 200,
      message: '?꾨줈???대?吏 ?섏젙 ?깃났',
      data,
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '?꾨줈???대?吏 ?섏젙 以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
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
      message: '?꾩옱 鍮꾨?踰덊샇? ??鍮꾨?踰덊샇瑜??낅젰?댁＜?몄슂.',
    });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({
      status: 400,
      message: '??鍮꾨?踰덊샇??8???댁긽?댁뼱???⑸땲??',
    });
  }

  try {
    await changeMyPassword(userId, currentPassword, newPassword);

    return res.status(200).json({
      status: 200,
      message: '鍮꾨?踰덊샇 蹂寃??깃났',
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
      message: '鍮꾨?踰덊샇 蹂寃?以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.',
    });
  }
};

const getMyActivityInterestsController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    const data = await getMyActivityInterests(userId, req.query);

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '관심 목록 조회 중 서버 오류가 발생했습니다.',
    });
  }
};

const getMyActivityCommentsController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    const data = await getMyActivityComments(userId, req.query);

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '댓글 목록 조회 중 서버 오류가 발생했습니다.',
    });
  }
};

const getMyActivityQnaController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    const data = await getMyActivityQna(userId, req.query);

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: 'Q&A 목록 조회 중 서버 오류가 발생했습니다.',
    });
  }
};

const getMyActivityFundingJournalCommentsController = async (req, res) => {
  const userId = getAuthenticatedUserId(req, res);

  if (!userId) {
    return;
  }

  try {
    const data = await getMyActivityFundingJournalComments(userId, req.query);

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: '양조일지 댓글 목록 조회 중 서버 오류가 발생했습니다.',
    });
  }
};

module.exports = {
  getMyProfileController,
  getMyPageSummaryController,
  getMyBadgesController,
  getMySulbtiController,
  getMySulbtiShareLinkController,
  saveMySulbtiController,
  getMyArchivesController,
  getMyArchiveDetailController,
  createMyArchiveController,
  createMyArchiveWithImagesController,
  updateMyArchiveController,
  updateMyArchiveWithImagesController,
  deleteMyArchiveController,
  uploadArchiveImagesController,
  deleteArchiveImageController,
  getArchiveTagsController,
  getParticipatedFundingsController,
  getParticipatedFundingOrderDetailController,
  getMyFundingReviewController,
  getMyActivityInterestsController,
  getMyActivityCommentsController,
  getMyActivityQnaController,
  getMyActivityFundingJournalCommentsController,
  checkNicknameController,
  updateNicknameController,
  updatePhoneNumberController,
  requestPhoneVerificationController,
  updateProfileImageController,
  changeMyPasswordController,
};
