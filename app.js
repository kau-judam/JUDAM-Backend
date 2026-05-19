const express = require('express');
const cors = require('cors');
const authRoutes = require('./src/routes/auth.routes');
const legacyAuthRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const recipeRoutes = require('./src/routes/recipeRoutes');
const fundingRoutes = require('./src/routes/fundingRoutes');
const aiRoutes = require('./src/routes/ai.routes');
const orderRoutes = require('./src/routes/orderRoutes'); //결제요청
const breweryRoutes = require('./src/routes/brewery.routes');
const adminRoutes = require('./src/routes/adminRoutes');
const paymentRoutes = require('./src/routes/payment.routes');
const sqsRoutes = require('./src/routes/sqsRoutes');
const aiRecipeRoutes = require('./src/routes/aiRecipe.routes');
const postRoutes = require('./src/routes/postRoutes');

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
app.use('/api/users', userRoutes);
app.use('/api/recipes', recipeRoutes);
app.use('/api/fundings', fundingRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/sqs', sqsRoutes);
app.use('/api/breweries', breweryRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/recipe', aiRecipeRoutes);
app.use('/api/posts', postRoutes);

module.exports = app;
