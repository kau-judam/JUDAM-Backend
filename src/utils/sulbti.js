const SULBTI_TYPE_CODES = Object.freeze([
  'SHFC',
  'SHFU',
  'SHMC',
  'SHMU',
  'SLFC',
  'SLFU',
  'SLMC',
  'SLMU',
  'DHFC',
  'DHFU',
  'DHMC',
  'DHMU',
  'DLFC',
  'DLFU',
  'DLMC',
  'DLMU',
]);

const SULBTI_TYPE_CODE_SET = new Set(SULBTI_TYPE_CODES);

const normalizeSulbtiTypeCode = (value) => (
  typeof value === 'string' ? value.trim().toUpperCase() : ''
);

const isSulbtiTypeCode = (value) => (
  SULBTI_TYPE_CODE_SET.has(normalizeSulbtiTypeCode(value))
);

module.exports = {
  SULBTI_TYPE_CODES,
  normalizeSulbtiTypeCode,
  isSulbtiTypeCode,
};
