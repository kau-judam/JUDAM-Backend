const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');
const {
  createBreweryApplication,
  getBreweryApplications,
  getMyBreweryApplication,
  approveBreweryApplication,
  rejectBreweryApplication,
} = require('../controllers/brewery.controller');

const router = express.Router();

router.post('/applications', authMiddleware, createBreweryApplication);
router.get('/applications', authMiddleware, getBreweryApplications);
router.get('/applications/me', authMiddleware, getMyBreweryApplication);
router.patch('/applications/:applicationId/approve', authMiddleware, approveBreweryApplication);
router.patch('/applications/:applicationId/reject', authMiddleware, rejectBreweryApplication);

module.exports = router;
