const express = require('express');

const {
  ingredientRegionController,
  getIngredientRegionController,
  suggestSubIngredientsController,
  suggestFlavorTagsController,
  suggestSummaryController,
} = require('../controllers/aiRecipe.controller');

const router = express.Router();

router.get('/ingredient-region', getIngredientRegionController);
router.post('/ingredient-region', ingredientRegionController);
router.post('/suggest-sub-ingredients', suggestSubIngredientsController);
router.post('/suggest-flavor-tags', suggestFlavorTagsController);
router.post('/suggest-summary', suggestSummaryController);

module.exports = router;
