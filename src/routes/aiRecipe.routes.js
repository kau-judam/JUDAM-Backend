const express = require('express');

const {
  suggestSubIngredientsController,
  suggestFlavorTagsController,
  suggestSummaryController,
} = require('../controllers/aiRecipe.controller');

const router = express.Router();

router.post('/suggest-sub-ingredients', suggestSubIngredientsController);
router.post('/suggest-flavor-tags', suggestFlavorTagsController);
router.post('/suggest-summary', suggestSummaryController);

module.exports = router;
