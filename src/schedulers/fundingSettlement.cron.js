const cron = require('node-cron');
const {
  KST_TIMEZONE,
  settleExpiredFundings,
} = require('../services/funding.service');

const FUNDING_SETTLEMENT_CRON = '5 0 * * *';

let fundingSettlementTask = null;

const startFundingSettlementCron = () => {
  if (fundingSettlementTask) {
    return fundingSettlementTask;
  }

  fundingSettlementTask = cron.schedule(
    FUNDING_SETTLEMENT_CRON,
    async () => {
      console.log('[funding-settlement] scheduled settlement started', {
        timezone: KST_TIMEZONE,
        executedAt: new Date().toISOString(),
      });

      try {
        const settlementResult = await settleExpiredFundings();

        console.log('[funding-settlement] scheduled settlement completed', {
          timezone: KST_TIMEZONE,
          successCount: settlementResult.successCount,
          failedCount: settlementResult.failedCount,
          processedCount: settlementResult.processedFundings.length,
        });
      } catch (error) {
        console.error('[funding-settlement] scheduled settlement failed', error);
      }
    },
    {
      scheduled: true,
      timezone: KST_TIMEZONE,
    },
  );

  console.log('[funding-settlement] cron registered', {
    schedule: FUNDING_SETTLEMENT_CRON,
    timezone: KST_TIMEZONE,
  });

  return fundingSettlementTask;
};

module.exports = {
  startFundingSettlementCron,
};
