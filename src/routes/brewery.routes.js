const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middlewares/authMiddleware');
const {
  createBreweryApplication,
  getBreweryApplications,
  getMyBreweryApplication,
  approveBreweryApplication,
  rejectBreweryApplication,
} = require('../controllers/brewery.controller');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/applications', authMiddleware, upload.single('businessLicense'), createBreweryApplication);
router.get('/applications', authMiddleware, getBreweryApplications);
router.get('/applications/me', authMiddleware, getMyBreweryApplication);
router.patch('/applications/:applicationId/approve', authMiddleware, approveBreweryApplication);
router.patch('/applications/:applicationId/reject', authMiddleware, rejectBreweryApplication);

module.exports = router;
