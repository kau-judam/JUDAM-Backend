const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { postRecipe } = require('../controllers/recipeController');

router.post('/', authMiddleware, postRecipe);

module.exports = router;
