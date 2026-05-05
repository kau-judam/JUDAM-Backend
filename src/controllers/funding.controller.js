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

module.exports = {
  saveAgreement,
  createFundingDraft,
  updateFundingDraft,
  saveBasicInfo,
  saveSchedule,
  saveLegalInfo,
};