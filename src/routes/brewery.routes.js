const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');
const {
  createBreweryApplication,
  getMyBreweryApplication,
  approveBreweryApplication,
} = require('../controllers/brewery.controller');

const router = express.Router();

router.post('/applications', authMiddleware, createBreweryApplication);
router.get('/applications/me', authMiddleware, getMyBreweryApplication);
router.patch('/applications/:applicationId/approve', authMiddleware, approveBreweryApplication);

module.exports = router;
