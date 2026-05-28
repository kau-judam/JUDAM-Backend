const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middlewares/authMiddleware');
const {
  getMyBreweryProfile,
  getMyBreweryDashboardBasicInfo,
  updateMyBreweryProfile,
  getMyBreweryDashboardNotifications,
  createBreweryApplication,
  getBreweryApplications,
  getMyBreweryApplication,
  updateMyApprovedBreweryApplication,
  approveBreweryApplication,
  rejectBreweryApplication,
} = require('../controllers/brewery.controller');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/me/profile', authMiddleware, getMyBreweryProfile);
router.patch('/me/profile', authMiddleware, updateMyBreweryProfile);
router.get('/me/dashboard/basic-info', authMiddleware, getMyBreweryDashboardBasicInfo);
router.get('/me/dashboard/notifications', authMiddleware, getMyBreweryDashboardNotifications);

router.post('/applications', authMiddleware, upload.single('businessLicense'), createBreweryApplication);
router.get('/applications', authMiddleware, getBreweryApplications);
router.get('/applications/me', authMiddleware, getMyBreweryApplication);
router.patch('/applications/me', authMiddleware, updateMyApprovedBreweryApplication);
router.patch('/applications/:applicationId/approve', authMiddleware, approveBreweryApplication);
router.patch('/applications/:applicationId/reject', authMiddleware, rejectBreweryApplication);

module.exports = router;
