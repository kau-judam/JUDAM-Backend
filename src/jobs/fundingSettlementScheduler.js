const { settleExpiredFundings } = require('../services/fundingSettlement.service');

const KST_UTC_OFFSET_MS = 9 * 60 * 60 * 1000;
const SETTLEMENT_HOUR = 0;
const SETTLEMENT_MINUTE = 5;

let timer = null;
let isRunning = false;

const getDelayUntilNextKstSettlement = (now = new Date()) => {
  const kstNow = new Date(now.getTime() + KST_UTC_OFFSET_MS);
  const targetKst = new Date(kstNow);
  targetKst.setUTCHours(SETTLEMENT_HOUR, SETTLEMENT_MINUTE, 0, 0);

  if (kstNow >= targetKst) {
    targetKst.setUTCDate(targetKst.getUTCDate() + 1);
  }

  const targetUtcTime = targetKst.getTime() - KST_UTC_OFFSET_MS;
  return Math.max(targetUtcTime - now.getTime(), 1000);
};

const runSettlement = async () => {
  if (isRunning) {
    return;
  }

  isRunning = true;

  try {
    const result = await settleExpiredFundings();
    console.log('Funding settlement completed', {
      successCount: result.successCount,
      failedCount: result.failedCount,
      processedCount: result.processedCount,
    });
  } catch (error) {
    console.error('Funding settlement failed', error);
  } finally {
    isRunning = false;
  }
};

const scheduleNextSettlement = () => {
  const delay = getDelayUntilNextKstSettlement();
  timer = setTimeout(async () => {
    await runSettlement();
    scheduleNextSettlement();
  }, delay);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
};

const startFundingSettlementScheduler = () => {
  if (timer) {
    return;
  }

  scheduleNextSettlement();
};

module.exports = {
  getDelayUntilNextKstSettlement,
  startFundingSettlementScheduler,
};
