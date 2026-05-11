const db = require('../config/db');

//펀딩 약관 동의
const saveAgreement = (req, res) => {
  const {
    breweryId,
    isAdultConfirmed,
    isContactInfoAgreed,
    isSettlementInfoAgreed,
    isFeePolicyAgreed,
    isResponsibilityAgreed,
  } = req.body;

  if (
    !breweryId ||
    !isAdultConfirmed ||
    !isContactInfoAgreed ||
    !isSettlementInfoAgreed ||
    !isFeePolicyAgreed ||
    !isResponsibilityAgreed
  ) {
    return res.status(400).json({
      status: 400,
      message: '필수 약관에 모두 동의해야 합니다.',
    });
  }

  const agreementId = 1;

  return res.status(200).json({
    agreementId,
    breweryId,
    message: '펀딩 약관 동의가 저장되었습니다.',
  });
};

//펀딩 프로젝트 임시저장
const createFundingDraft = (req, res) => {
  const {
    breweryId,
    title,
    shortTitle,
    category,
    mainIngredient,
    subIngredient,
    alcoholPercentage,
    summary,
  } = req.body;

  if (!breweryId) {
    return res.status(400).json({
      status: 400,
      message: '양조장 ID는 필수입니다.',
    });
  }

  const progressFields = [
    title,
    shortTitle,
    category,
    mainIngredient,
    subIngredient,
    alcoholPercentage,
    summary,
  ];

  const filledCount = progressFields.filter(
    (field) => field !== undefined && field !== null && field !== ''
  ).length;

  const progressRate = Math.round((filledCount / progressFields.length) * 30);

  return res.status(201).json({
    draftId: 1,
    breweryId,
    status: 'DRAFT',
    progressRate,
    message: '펀딩 프로젝트가 임시저장되었습니다.',
  });
};

//임시저장 프로젝트 수정
const updateFundingDraft = (req, res) => {
  const { draftId } = req.params;

  const {
    title,
    shortTitle,
    summary,
    alcoholPercentage,
  } = req.body;

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '입력값이 올바르지 않습니다.',
    });
  }

  const progressFields = [
    title,
    shortTitle,
    summary,
    alcoholPercentage,
  ];

  const filledCount = progressFields.filter(
    (field) => field !== undefined && field !== null && field !== ''
  ).length;

  const progressRate = Math.round((filledCount / progressFields.length) * 33);

  return res.status(200).json({
    draftId: Number(draftId),
    status: 'DRAFT',
    progressRate,
    updatedAt: new Date().toISOString(),
    message: '임시저장 프로젝트가 수정되었습니다.',
  });
};
//프로젝트 기본정보 저장 
const saveBasicInfo = (req, res) => {
  const { draftId } = req.params;

  const {
    title,
    shortTitle,
    category,
    mainIngredient,
    subIngredients,
    alcoholPercentage,
    summary,
    thumbnailUrl,
  } = req.body;

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '입력값이 올바르지 않습니다.',
    });
  }

  if (subIngredients && !Array.isArray(subIngredients)) {
    return res.status(400).json({
      status: 400,
      message: '입력값이 올바르지 않습니다.',
    });
  }

  return res.status(200).json({
    draftId: Number(draftId),
    section: 'BASIC_INFO',
    progressRate: 33,
    message: '기본정보가 저장되었습니다.',
  });
};
//목표금액 & 일정 
const saveSchedule = (req, res) => {
  const { draftId } = req.params;

  const {
    pricePerBottle,
    totalQuantity,
    fundingStartDate,
    fundingPeriodDays,
    fundingEndDate,
    expectedDeliveryDate,
  } = req.body;

  if (
    !draftId ||
    isNaN(Number(draftId)) ||
    !pricePerBottle ||
    !totalQuantity ||
    !fundingStartDate ||
    !fundingPeriodDays ||
    !fundingEndDate ||
    !expectedDeliveryDate
  ) {
    return res.status(400).json({
      status: 400,
      message: '입력값이 올바르지 않습니다.',
    });
  }

  const endDate = new Date(fundingEndDate);
  const deliveryDate = new Date(expectedDeliveryDate);

  const minDeliveryDate = new Date(endDate);
  minDeliveryDate.setDate(minDeliveryDate.getDate() + 30);

  if (deliveryDate < minDeliveryDate) {
    return res.status(400).json({
      status: 400,
      message: '예상 배송일은 펀딩 종료일로부터 최소 30일 이후여야 합니다.',
    });
  }

  const targetAmount = pricePerBottle * totalQuantity;
  const platformFeeRate = 7;
  const platformFeeAmount = Math.round(targetAmount * (platformFeeRate / 100));

  return res.status(200).json({
    draftId: Number(draftId),
    section: 'SCHEDULE',
    targetAmount,
    platformFeeRate,
    platformFeeAmount,
    progressRate: 47,
    message: '목표 금액 및 일정이 저장되었습니다.',
  });
};

//법적 고시 정보 저장
const saveLegalInfo = (req, res) => {
  const { draftId } = req.params;

  const {
    productType,
    volume,
    alcoholPercentage,
    rawMaterials,
  } = req.body;

  if (
    !draftId ||
    isNaN(Number(draftId)) ||
    !productType ||
    !volume ||
    !alcoholPercentage ||
    !Array.isArray(rawMaterials)
  ) {
    return res.status(400).json({
      status: 400,
      message: '법적 고시 정보 입력이 올바르지 않습니다.',
    });
  }

  if (rawMaterials.length === 0) {
    return res.status(400).json({
      status: 400,
      message: '최소 1개 이상의 원재료를 입력해야 합니다.',
    });
  }

  const hasInvalidMaterial = rawMaterials.some(
    (material) => !material.name || !material.origin
  );

  if (hasInvalidMaterial) {
    return res.status(400).json({
      status: 400,
      message: '법적 고시 정보 입력이 올바르지 않습니다.',
    });
  }

  return res.status(200).json({
    draftId: Number(draftId),
    section: 'LEGAL_INFO',
    progressRate: 57,
    message: '법적 고시 정보가 저장되었습니다.',
  });
};

//맛지표관련
const saveTasteProfile = (req, res) => {
  const { draftId } = req.params;

  const {
    sweetness,
    acidity,
    body,
    carbonation,
    alcoholIntensity,
    flavorNotes,
  } = req.body;

  if (
    !draftId ||
    isNaN(Number(draftId)) ||
    sweetness === undefined ||
    acidity === undefined ||
    body === undefined ||
    carbonation === undefined ||
    alcoholIntensity === undefined
  ) {
    return res.status(400).json({
      status: 400,
      message: '맛지표 입력값이 올바르지 않습니다.',
    });
  }

  const tasteValues = [
    sweetness,
    acidity,
    body,
    carbonation,
    alcoholIntensity,
  ];

  const isOutOfRange = tasteValues.some(
    (value) => typeof value !== 'number' || value < 1 || value > 5
  );

  if (isOutOfRange) {
    return res.status(400).json({
      status: 400,
      message: '맛지표는 1부터 5 사이의 값이어야 합니다.',
    });
  }

  if (flavorNotes && !Array.isArray(flavorNotes)) {
    return res.status(400).json({
      status: 400,
      message: '맛지표 입력값이 올바르지 않습니다.',
    });
  }

  return res.status(200).json({
    draftId: Number(draftId),
    section: 'TASTE_PROFILE',
    progressRate: 64,
    message: '맛지표 정보가 저장되었습니다.',
  });
};

//프로젝트 계획 정보 저장 API(프로젝트소개+예산배열검증+일정배열검증)
const savePlan = (req, res) => {
  const { draftId } = req.params;

  const { introduction, budgetPlan, schedulePlan } = req.body;

  if (
    !draftId ||
    isNaN(Number(draftId)) ||
    !introduction ||
    !Array.isArray(budgetPlan) ||
    !Array.isArray(schedulePlan)
  ) {
    return res.status(400).json({
      status: 400,
      message: '프로젝트 계획 입력값이 올바르지 않습니다.',
    });
  }

  if (budgetPlan.length === 0) {
    return res.status(400).json({
      status: 400,
      message: '예산 항목은 최소 1개 이상 입력해야 합니다.',
    });
  }

  if (schedulePlan.length === 0) {
    return res.status(400).json({
      status: 400,
      message: '일정 단계는 최소 1개 이상 입력해야 합니다.',
    });
  }

  const hasInvalidBudget = budgetPlan.some(
    (budget) => !budget.category || !budget.amount || typeof budget.amount !== 'number'
  );

  if (hasInvalidBudget) {
    return res.status(400).json({
      status: 400,
      message: '프로젝트 계획 입력값이 올바르지 않습니다.',
    });
  }

  const hasInvalidSchedule = schedulePlan.some(
    (schedule) => !schedule.step || !schedule.description || !schedule.date
  );

  if (hasInvalidSchedule) {
    return res.status(400).json({
      status: 400,
      message: '프로젝트 계획 입력값이 올바르지 않습니다.',
    });
  }

  return res.status(200).json({
    draftId: Number(draftId),
    section: 'PLAN',
    progressRate: 78,
    message: '프로젝트 계획 정보가 저장되었습니다.',
  });
};

//창작자/정산/사업자 정보 저장
const saveBreweryInfo = (req, res) => {
  const { draftId } = req.params;

  const {
    breweryName,
    representativeName,
    businessRegistrationNumber,
    businessAddress,
    contactEmail,
    contactPhone,
    bankName,
    accountNumber,
    accountHolder,
  } = req.body;

  if (
    !draftId ||
    isNaN(Number(draftId)) ||
    !breweryName ||
    !representativeName ||
    !businessRegistrationNumber ||
    !businessAddress ||
    !contactEmail ||
    !contactPhone ||
    !bankName ||
    !accountNumber ||
    !accountHolder
  ) {
    return res.status(400).json({
      status: 400,
      message: '양조장 정보 입력값이 올바르지 않습니다.',
    });
  }

  const businessNumberRegex = /^\d{3}-\d{2}-\d{5}$/;

  if (!businessNumberRegex.test(businessRegistrationNumber)) {
    return res.status(400).json({
      status: 400,
      message: '사업자등록번호 형식이 올바르지 않습니다.',
    });
  }

  return res.status(200).json({
    draftId: Number(draftId),
    section: 'BREWERY_INFO',
    progressRate: 85,
    message: '창작자/정산/사업자 정보가 저장되었습니다.',
  });
};

//환불/교환/성인인증/리스크 안내 저장
const saveNotices = (req, res) => {
  const { draftId } = req.params;

  const {
    refundPolicy,
    exchangePolicy,
    adultVerificationNotice,
    riskNotice,
  } = req.body;

  if (!draftId || isNaN(Number(draftId))) {
    return res.status(400).json({
      status: 400,
      message: '안내사항 입력값이 올바르지 않습니다.',
    });
  }

  if (
    !refundPolicy ||
    !exchangePolicy ||
    !adultVerificationNotice ||
    !riskNotice
  ) {
    return res.status(400).json({
      status: 400,
      message: '필수 안내사항을 모두 입력해야 합니다.',
    });
  }

  return res.status(200).json({
    draftId: Number(draftId),
    section: 'NOTICES',
    progressRate: 92,
    message: '안내사항 정보가 저장되었습니다.',
  });
};

//필수 서류 업로드
const uploadDocument = (req, res) => {
  const { draftId } = req.params;
  const { documentType } = req.body;
  const file = req.file;

  const allowedDocumentTypes = [
    'BUSINESS_REGISTRATION',
    'MAIL_ORDER_BUSINESS',
    'LIQUOR_LICENSE',
    'BANK_ACCOUNT_COPY',
    'ETC',
  ];

  if (!draftId || isNaN(Number(draftId)) || !documentType) {
    return res.status(400).json({
      status: 400,
      message: '서류 업로드 요청값이 올바르지 않습니다.',
    });
  }

  if (!allowedDocumentTypes.includes(documentType)) {
    return res.status(400).json({
      status: 400,
      message: '서류 업로드 요청값이 올바르지 않습니다.',
    });
  }

  if (!file) {
    return res.status(400).json({
      status: 400,
      message: '업로드할 파일이 필요합니다.',
    });
  }

  const allowedMimeTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
  ];

  if (!allowedMimeTypes.includes(file.mimetype)) {
    return res.status(400).json({
      status: 400,
      message: '지원하지 않는 파일 형식입니다.',
    });
  }

  return res.status(201).json({
    draftId: Number(draftId),
    documentId: 10,
    documentType,
    fileName: file.originalname,
    fileUrl: `https://storage.example.com/documents/${file.originalname}`,
    message: '필수 서류가 업로드되었습니다.',
  });
};

//펀딩프로젝트 목록 조회
const getFundingList = (req, res) => {
  const { status, sort, page = 0, size = 10 } = req.query;

  const allowedStatuses = ['UPCOMING', 'ONGOING', 'ENDED'];
  const allowedSorts = ['POPULAR', 'LATEST', 'DEADLINE'];

  if (status && !allowedStatuses.includes(status)) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청 파라미터입니다.',
    });
  }

  if (sort && !allowedSorts.includes(sort)) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청 파라미터입니다.',
    });
  }

  const pageNumber = Number(page);
  const sizeNumber = Number(size);

  if (
    Number.isNaN(pageNumber) ||
    Number.isNaN(sizeNumber) ||
    pageNumber < 0 ||
    sizeNumber <= 0
  ) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청 파라미터입니다.',
    });
  }

  return res.status(200).json({
    content: [
      {
        fundingId: 1,
        title: '벚꽃 막걸리 프로젝트',
        thumbnailUrl: 'https://example.com/image.jpg',
        breweryName: '삼해소주가',
        currentAmount: 3200000,
        targetAmount: 5000000,
        achievementRate: 64,
        status: 'ONGOING',
        endDate: '2026-05-30',
      },
    ],
    page: pageNumber,
    size: sizeNumber,
    totalElements: 25,
    totalPages: 3,
  });
};

//펀딩 프러젝트 상세조회
const getFundingDetail = (req, res) => {
  const { fundingId } = req.params;

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  return res.status(200).json({
    fundingId: Number(fundingId),
    title: '벚꽃 막걸리 프로젝트',
    summary: '못난이 쌀과 벚꽃 추출물을 활용한 봄 한정 막걸리',
    thumbnailUrl: 'https://example.com/image.jpg',
    breweryName: '삼해소주가',
    status: 'ONGOING',
    currentAmount: 3200000,
    targetAmount: 5000000,
    achievementRate: 64,
    supporterCount: 128,
    startDate: '2026-05-01',
    endDate: '2026-05-30',
    expectedDeliveryDate: '2026-06-20',
    tasteProfile: {
      sweetness: 3,
      acidity: 4,
      body: 2,
      carbonation: 3,
      alcoholIntensity: 2,
      flavorNotes: ['쌀향', '꽃향', '산뜻함'],
    },
    supportOptions: [
      {
        optionId: 1,
        name: '벚꽃 막걸리 1병',
        price: 18000,
        description: '750ml 1병 구성',
      },
      {
        optionId: 2,
        name: '벚꽃 막걸리 3병 세트',
        price: 50000,
        description: '750ml 3병 구성',
      },
    ],
  });
};

//프로젝트 소개 조회
const getFundingIntro = (req, res) => {
  const { fundingId } = req.params;

  // 유효성 검증
  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '프로젝트를 찾을 수 없습니다.',
    });
  }

  return res.status(200).json({
    fundingId: Number(fundingId),
    title: '벚꽃 막걸리 프로젝트',
    introduction: '못난이 농산물을 활용하여 새로운 전통주를 만드는 프로젝트입니다.',
    story: '이 프로젝트는 지역 농가의 버려지는 사과를 활용하여 새로운 가치를 만들어내기 위해 시작되었습니다...',
    images: [
      'https://example.com/intro1.jpg',
      'https://example.com/intro2.jpg',
    ],
  });
};

//양조일지 조회
const getBreweryLogs = (req, res) => {
  const { fundingId } = req.params;

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  return res.status(200).json({
    fundingId: Number(fundingId),
    logs: [
      {
        logId: 1,
        step: '원재료 수급',
        title: '못난이 사과 수급 완료',
        content: '지역 농가에서 못난이 사과 100kg을 수급했습니다.',
        imageUrls: ['https://example.com/log1.jpg'],
        createdAt: '2026-05-03T14:30:00',
      },
    ],
  });
};
//qna 목록 조회
const getFundingQuestions = (req, res) => {
  const { fundingId } = req.params;
  const { page = 0, size = 10, answered } = req.query;

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  const pageNumber = Number(page);
  const sizeNumber = Number(size);

  if (
    Number.isNaN(pageNumber) ||
    Number.isNaN(sizeNumber) ||
    pageNumber < 0 ||
    sizeNumber <= 0
  ) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청 파라미터입니다.',
    });
  }

  if (
    answered !== undefined &&
    answered !== 'true' &&
    answered !== 'false'
  ) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청 파라미터입니다.',
    });
  }

  const answeredValue =
    answered === undefined ? true : answered === 'true';

  return res.status(200).json({
    content: [
      {
        questionId: 1,
        writerNickname: '술좋아하는재원',
        title: '배송은 언제 시작되나요?',
        content: '펀딩 종료 후 배송 예정일이 궁금합니다.',
        answered: answeredValue,
        createdAt: '2026-05-01T13:20:00',
      },
    ],
    page: pageNumber,
    size: sizeNumber,
    totalElements: 12,
    totalPages: 2,
  });
};

//qna 질문등록
const createFundingQuestion = (req, res) => {
  const { fundingId } = req.params;
  const { title, content, isPrivate = false } = req.body;

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  if (
    !title ||
    !content ||
    typeof title !== 'string' ||
    typeof content !== 'string' ||
    title.trim() === '' ||
    content.trim() === ''
  ) {
    return res.status(400).json({
      status: 400,
      message: '질문 입력값이 올바르지 않습니다.',
    });
  }

  if (typeof isPrivate !== 'boolean') {
    return res.status(400).json({
      status: 400,
      message: '질문 입력값이 올바르지 않습니다.',
    });
  }

  return res.status(201).json({
    fundingId: Number(fundingId),
    questionId: 15,
    message: '질문이 등록되었습니다.',
  });
};

//qna 답글 등록
const createFundingReply = (req, res) => {
  const { fundingId, questionId } = req.params;
  const { content } = req.body;

  // fundingId, questionId 검증
  if (
    !fundingId ||
    isNaN(Number(fundingId)) ||
    !questionId ||
    isNaN(Number(questionId))
  ) {
    return res.status(404).json({
      status: 404,
      message: '질문 또는 프로젝트를 찾을 수 없습니다.',
    });
  }

  // content 검증
  if (
    !content ||
    typeof content !== 'string' ||
    content.trim() === ''
  ) {
    return res.status(400).json({
      status: 400,
      message: '답변 입력값이 올바르지 않습니다.',
    });
  }

  // (mock) 이미 답변이 있는 경우 처리 예시
  const alreadyAnswered = false;

  if (alreadyAnswered) {
    return res.status(409).json({
      status: 409,
      message: '이미 답변이 등록된 질문입니다.',
    });
  }

  return res.status(201).json({
    fundingId: Number(fundingId),
    questionId: Number(questionId),
    replyId: 3,
    message: '답변이 등록되었습니다.',
  });
};

//후기목록조회
const getFundingReviews = (req, res) => {
  const { fundingId } = req.params;
  const { page = 0, size = 10, sort = 'LATEST' } = req.query;

  // fundingId 검증
  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  const pageNumber = Number(page);
  const sizeNumber = Number(size);

  // page, size 검증
  if (
    Number.isNaN(pageNumber) ||
    Number.isNaN(sizeNumber) ||
    pageNumber < 0 ||
    sizeNumber <= 0
  ) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청 파라미터입니다.',
    });
  }

  const allowedSorts = ['LATEST', 'RATING'];

  if (!allowedSorts.includes(sort)) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청 파라미터입니다.',
    });
  }

  return res.status(200).json({
    content: [
      {
        reviewId: 1,
        writerNickname: '막걸리러버',
        rating: 4.5,
        content: '향이 정말 좋고 부드러워서 만족스러웠습니다!',
        imageUrls: ['https://example.com/review1.jpg'],
        createdAt: '2026-06-10T12:30:00',
      },
    ],
    page: pageNumber,
    size: sizeNumber,
    totalElements: 20,
    totalPages: 2,
  });
};

//후원옵션조회
const getSupportOptions = async (req, res) => {
  const { fundingId } = req.params;

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  try {
    const result = await db.query(
      `
      SELECT
        option_id,
        funding_id,
        name,
        price,
        description,
        stock,
        remaining_stock,
        max_per_user
      FROM funding_support_options
      WHERE funding_id = $1
      ORDER BY option_id ASC
      `,
      [Number(fundingId)]
    );

    return res.status(200).json({
      fundingId: Number(fundingId),
      supportOptions: result.rows.map((option) => ({
        optionId: option.option_id,
        name: option.name,
        price: option.price,
        description: option.description,
        stock: option.stock,
        remainingStock: option.remaining_stock,
        maxPerUser: option.max_per_user,
      })),
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '후원 옵션 조회 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 후원 주문 생성
const createFundingOrder = async (req, res) => {
  const { fundingId } = req.params;

  const {
    optionId,
    quantity,
    recipientName,
    recipientPhone,
    shippingAddress,
    shippingDetailAddress,
    adultVerified,
    noticeAgreed,
  } = req.body;

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  if (
    !optionId ||
    !quantity ||
    !recipientName ||
    !recipientPhone ||
    !shippingAddress
  ) {
    return res.status(400).json({
      status: 400,
      message: '주문 입력값이 올바르지 않습니다.',
    });
  }

  if (!adultVerified) {
    return res.status(400).json({
      status: 400,
      message: '주류 후원을 위해 성인인증이 필요합니다.',
    });
  }

  if (!noticeAgreed) {
    return res.status(400).json({
      status: 400,
      message: '환불/교환/리스크 안내에 동의해야 합니다.',
    });
  }

  try {
    const optionResult = await db.query(
      `
      SELECT option_id, funding_id, price, remaining_stock
      FROM funding_support_options
      WHERE option_id = $1
        AND funding_id = $2
      `,
      [Number(optionId), Number(fundingId)]
    );

    if (optionResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        message: '후원 옵션을 찾을 수 없습니다.',
      });
    }

    const option = optionResult.rows[0];

    if (
      option.remaining_stock !== null &&
      option.remaining_stock < Number(quantity)
    ) {
      return res.status(400).json({
        status: 400,
        message: '남은 수량이 부족합니다.',
      });
    }

    const totalAmount = Number(option.price) * Number(quantity);

    // TODO: JWT 연결 후 req.user.userId 사용
    const userId = req.user?.userId || 1;

    const orderResult = await db.query(
      `
      INSERT INTO orders (
        user_id,
        funding_id,
        option_id,
        quantity,
        total_amount,
        order_status,
        recipient_name,
        recipient_phone,
        shipping_address,
        shipping_detail_address,
        adult_verified,
        notice_agreed
      )
      VALUES ($1, $2, $3, $4, $5, 'CREATED', $6, $7, $8, $9, $10, $11)
      RETURNING order_id, funding_id, option_id, quantity, total_amount, order_status, created_at
      `,
      [
        userId,
        Number(fundingId),
        Number(optionId),
        Number(quantity),
        totalAmount,
        recipientName,
        recipientPhone,
        shippingAddress,
        shippingDetailAddress || null,
        adultVerified,
        noticeAgreed,
      ]
    );

    const order = orderResult.rows[0];

    return res.status(201).json({
      orderId: order.order_id,
      fundingId: order.funding_id,
      optionId: order.option_id,
      quantity: order.quantity,
      totalAmount: order.total_amount,
      orderStatus: order.order_status,
      createdAt: order.created_at,
      message: '후원 주문이 생성되었습니다.',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      message: '후원 주문 생성 중 서버 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

//양조장문의등록
const createFundingInquiry = (req, res) => {
  const { fundingId } = req.params;
  const { title, content } = req.body;

  // fundingId 검증
  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  // 입력값 검증
  if (
    !title ||
    !content ||
    typeof title !== 'string' ||
    typeof content !== 'string' ||
    title.trim() === '' ||
    content.trim() === ''
  ) {
    return res.status(400).json({
      status: 400,
      message: '문의 입력값이 올바르지 않습니다.',
    });
  }

  return res.status(201).json({
    fundingId: Number(fundingId),
    inquiryId: 21,
    message: '문의가 등록되었습니다.',
  });
};

//추가부분1: 양조일지 등록
const createBreweryLog = (req, res) => {
  const { fundingId } = req.params;
  const { stage, title, content } = req.body;
  const files = req.files || [];

  const allowedStages = [
    'INGREDIENT',
    'FERMENTATION',
    'AGING',
    'BOTTLING',
    'SHIPPING',
  ];

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  if (!stage || !title || !content) {
    return res.status(400).json({
      status: 400,
      message: '양조일지 제목과 내용을 입력해야 합니다.',
    });
  }

  if (!allowedStages.includes(stage)) {
    return res.status(400).json({
      status: 400,
      message: '양조 진행 단계가 올바르지 않습니다.',
    });
  }

  const imageUrls = files.map(
    (file) => `https://s3.amazonaws.com/judam/${file.originalname}`
  );

  return res.status(201).json({
    breweryLogId: 1,
    fundingId: Number(fundingId),
    stage,
    title,
    imageUrls,
    message: '양조일지가 등록되었습니다.',
  });
};

//추가부분2: 양조일지 수정
const updateBreweryLog = (req, res) => {
  const { fundingId, breweryLogId } = req.params;
  const { stage, title, content, deleteImageUrls } = req.body;
  const files = req.files || [];

  const allowedStages = [
    'INGREDIENT',
    'FERMENTATION',
    'AGING',
    'BOTTLING',
    'SHIPPING',
  ];

  // fundingId, breweryLogId 검증
  if (
    !fundingId ||
    isNaN(Number(fundingId)) ||
    !breweryLogId ||
    isNaN(Number(breweryLogId))
  ) {
    return res.status(404).json({
      status: 404,
      message: '양조일지를 찾을 수 없습니다.',
    });
  }

  // 아무 수정값도 없는 경우
  if (!stage && !title && !content && files.length === 0 && !deleteImageUrls) {
    return res.status(400).json({
      status: 400,
      message: '양조일지 수정값이 올바르지 않습니다.',
    });
  }

  // stage Enum 검증
  if (stage && !allowedStages.includes(stage)) {
    return res.status(400).json({
      status: 400,
      message: '양조 진행 단계가 올바르지 않습니다.',
    });
  }

  // 새로 업로드된 이미지 URL mock 처리
  const uploadedImageUrls = files.map(
    (file) => `https://s3.amazonaws.com/judam/${file.originalname}`
  );

  // 기존 이미지 mock
  const existingImageUrls = [
    'https://s3.amazonaws.com/judam/existing-log1.png',
    'https://s3.amazonaws.com/judam/existing-log2.png',
  ];

  // 삭제할 이미지 URL 처리
  const deleteTargets = Array.isArray(deleteImageUrls)
    ? deleteImageUrls
    : deleteImageUrls
      ? [deleteImageUrls]
      : [];

  const remainingImageUrls = existingImageUrls.filter(
    (url) => !deleteTargets.includes(url)
  );

  const imageUrls = [...remainingImageUrls, ...uploadedImageUrls];

  return res.status(200).json({
    breweryLogId: Number(breweryLogId),
    fundingId: Number(fundingId),
    stage: stage || 'AGING',
    title: title || '숙성 단계에 들어갔습니다.',
    imageUrls,
    message: '양조일지가 수정되었습니다.',
  });
};

//추가3: 양조일지 삭제
const deleteBreweryLog = (req, res) => {
  const { fundingId, breweryLogId } = req.params;

  // fundingId, breweryLogId 검증
  if (
    !fundingId ||
    isNaN(Number(fundingId)) ||
    !breweryLogId ||
    isNaN(Number(breweryLogId))
  ) {
    return res.status(404).json({
      status: 404,
      message: '양조일지를 찾을 수 없습니다.',
    });
  }

  return res.status(200).json({
    breweryLogId: Number(breweryLogId),
    fundingId: Number(fundingId),
    message: '양조일지가 삭제되었습니다.',
  });
};

//추가4: 펀딩 공유 링크 조회
const getFundingShareLink = (req, res) => {
  const { fundingId } = req.params;

  // fundingId 검증
  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  return res.status(200).json({
    fundingId: Number(fundingId),
    shareUrl: `https://judam.com/fundings/${fundingId}`,
    message: '공유 링크가 생성되었습니다.',
  });
};

//추가부분5: 펀딩 신고 등록
const createFundingReport = (req, res) => {
  const { fundingId } = req.params;
  const { reason, content } = req.body;

  const allowedReasons = [
    'FALSE_INFORMATION',
    'INAPPROPRIATE_CONTENT',
    'COPYRIGHT',
    'FRAUD',
    'ETC',
  ];

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  if (!reason || !allowedReasons.includes(reason)) {
    return res.status(400).json({
      status: 400,
      message: '신고 입력값이 올바르지 않습니다.',
    });
  }

  return res.status(201).json({
    reportId: 1,
    fundingId: Number(fundingId),
    reason,
    message: '신고가 접수되었습니다.',
  });
};

//추가부분6: 펀딩 신고 목록 조회
const getFundingReports = (req, res) => {
  const { status, page = 0, size = 10 } = req.query;

  const allowedStatuses = ['PENDING', 'REVIEWING', 'RESOLVED', 'REJECTED'];

  if (status && !allowedStatuses.includes(status)) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청 파라미터입니다.',
    });
  }

  if (isNaN(Number(page)) || isNaN(Number(size))) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청 파라미터입니다.',
    });
  }

  return res.status(200).json({
    content: [
      {
        reportId: 1,
        fundingId: 12,
        fundingTitle: '벚꽃 막걸리 프로젝트',
        reporterId: 5,
        reporterNickname: '술좋아하는재원',
        reason: 'FALSE_INFORMATION',
        content: '프로젝트 설명에 사실과 다른 내용이 포함되어 있습니다.',
        status: status || 'PENDING',
        createdAt: '2026-05-10T13:30:00',
      },
    ],
    page: Number(page),
    size: Number(size),
    totalElements: 24,
    totalPages: 3,
  });
};

//추가부분8: 후기작성
const createFundingReview = (req, res) => {
  const { fundingId } = req.params;
  const { rating, content } = req.body;

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(404).json({
      status: 404,
      message: '펀딩 프로젝트를 찾을 수 없습니다.',
    });
  }

  if (
    !rating ||
    isNaN(Number(rating)) ||
    Number(rating) < 0 ||
    Number(rating) > 5 ||
    !content
  ) {
    return res.status(400).json({
      status: 400,
      message: '후기 입력값이 올바르지 않습니다.',
    });
  }

  const imageUrls = req.files
    ? req.files.map((file) => `/uploads/reviews/${file.filename}`)
    : [];

  return res.status(201).json({
    reviewId: 31,
    fundingId: Number(fundingId),
    rating: Number(rating),
    imageUrls,
    message: '후기가 등록되었습니다.',
  });
};

//추가부분9: 펀딩 찜 등록
const likeFundingProject = (req, res) => {
  const { fundingId } = req.params;

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청입니다.',
    });
  }

  return res.status(201).json({
    fundingId: Number(fundingId),
    liked: true,
    likeCount: 128,
    message: '펀딩 프로젝트를 찜했습니다.',
  });
};

//추가부분10: 펀딩 찜 해제
const unlikeFundingProject = (req, res) => {
  const { fundingId } = req.params;

  if (!fundingId || isNaN(Number(fundingId))) {
    return res.status(400).json({
      status: 400,
      message: '잘못된 요청입니다.',
    });
  }

  return res.status(200).json({
    fundingId: Number(fundingId),
    liked: false,
    likeCount: 127,
    message: '펀딩 프로젝트 찜이 해제되었습니다.',
  });
};


module.exports = {
  saveAgreement,
  createFundingDraft,
  updateFundingDraft,
  saveBasicInfo,
  saveSchedule,
  saveLegalInfo,
  saveTasteProfile,
  savePlan,
  saveBreweryInfo,
  saveNotices,
  uploadDocument,
  getFundingList,
  getFundingDetail,
  getFundingIntro,
  getBreweryLogs,
  getFundingQuestions,
  createFundingQuestion,
  createFundingReply,
  getFundingReviews,
  getSupportOptions,
  createFundingOrder,
  createFundingInquiry,
  getFundingShareLink,

  createBreweryLog,
  updateBreweryLog,
  deleteBreweryLog,
  getFundingShareLink,
  createFundingReport,
  getFundingReports,
  createFundingReview,
  likeFundingProject,
  unlikeFundingProject,
};