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

module.exports = {
  saveAgreement,
  createFundingDraft,
  updateFundingDraft
};