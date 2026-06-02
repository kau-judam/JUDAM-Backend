const express = require('express');
const cors = require('cors');
const mountRoutes = require('./src/routes');
const { startFundingSettlementCron } = require('./src/schedulers/fundingSettlement.cron');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({
    message: 'backend ok',
  });
});

mountRoutes(app);
startFundingSettlementCron();

module.exports = app;
