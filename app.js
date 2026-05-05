const express = require('express');
const cors = require('cors');
const authRoutes = require('./src/routes/auth.routes');
const legacyAuthRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const recipeRoutes = require('./src/routes/recipeRoutes');
const fundingRoutes = require('./src/routes/fundingRoutes');
const orderRoutes = require('./src/routes/orderRoutes'); //결제요청

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({
    message: 'backend ok',
  });
});

app.use('/api/auth', authRoutes);
app.use('/auth', legacyAuthRoutes);
app.use('/users', userRoutes);
app.use('/api/recipes', recipeRoutes);
app.use('/api/fundings', fundingRoutes);
app.use('/api/orders', orderRoutes);

module.exports = app;
