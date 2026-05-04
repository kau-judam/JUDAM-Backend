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
};