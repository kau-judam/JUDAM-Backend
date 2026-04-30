const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { postRecipe, getRecipeList, getRecipeDetail } = require('../controllers/recipeController');

router.post('/', authMiddleware, postRecipe);
router.get('/', getRecipeList);
router.get('/:recipeId', getRecipeDetail);

module.exports = router;
