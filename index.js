require('dotenv').config({ override: true });

const app = require('./app');
const { startFundingSettlementScheduler } = require('./src/jobs/fundingSettlementScheduler');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  startFundingSettlementScheduler();
});
