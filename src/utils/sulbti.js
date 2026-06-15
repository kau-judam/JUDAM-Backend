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

const normalizeSulbtiTypeCode = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  const compact = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const candidate = compact.slice(0, 4);

  return SULBTI_TYPE_CODE_SET.has(candidate) ? candidate : '';
};

const isSulbtiTypeCode = (value) => (
  SULBTI_TYPE_CODE_SET.has(normalizeSulbtiTypeCode(value))
);

module.exports = {
  SULBTI_TYPE_CODES,
  normalizeSulbtiTypeCode,
  isSulbtiTypeCode,
};
