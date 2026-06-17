const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middlewares/authMiddleware');
const {
  getMyBreweryProfile,
  getMyBreweryDashboardBasicInfo,
  updateMyBreweryProfile,
  uploadMyBreweryProfileImage,
  getMyBreweryDashboardFundingSummary,
  getMyBreweryDashboardFundings,
  getMyBreweryDashboardFundingDelivery,
  upsertMyBreweryDashboardFundingDelivery,
  getMyBreweryDashboardFundingOrders,
  upsertMyBreweryDashboardFundingOrderDelivery,
  getMyBreweryDashboardInsight,
  createMyBreweryInsightPaymentOrder,
  confirmMyBreweryInsightTossPayment,
  getMyBreweryInsightAccess,
  getMyBreweryDashboardNotifications,
  verifyBreweryAccount,
  createBreweryApplication,
  getBreweryApplications,
  getMyBreweryApplication,
  updateMyApprovedBreweryApplication,
  approveBreweryApplication,
  rejectBreweryApplication,
} = require('../controllers/brewery.controller');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const requireAdmin = (req, res, next) => {
  const role = String(req.user?.role || req.user?.userRole || req.user?.type || '').toUpperCase();

  if (role !== 'ADMIN') {
    return res.status(403).json({
      status: 403,
      message: '관리자만 접근할 수 있습니다.',
    });
  }

  return next();
};

router.get('/me/profile', authMiddleware, getMyBreweryProfile);
router.patch('/me/profile', authMiddleware, updateMyBreweryProfile);
router.patch(
  '/me/profile/image',
  authMiddleware,
  upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'profileImage', maxCount: 1 },
    { name: 'file', maxCount: 1 },
  ]),
  uploadMyBreweryProfileImage,
);
router.get('/me/dashboard/basic-info', authMiddleware, getMyBreweryDashboardBasicInfo);
router.get('/me/dashboard/funding-summary', authMiddleware, getMyBreweryDashboardFundingSummary);
router.get('/me/dashboard/fundings', authMiddleware, getMyBreweryDashboardFundings);
router.get(
  '/me/dashboard/fundings/:fundingId/delivery',
  authMiddleware,
  getMyBreweryDashboardFundingDelivery,
);
router.get(
  '/me/dashboard/fundings/:fundingId/orders',
  authMiddleware,
  getMyBreweryDashboardFundingOrders,
);
router.patch(
  '/me/dashboard/fundings/:fundingId/delivery',
  authMiddleware,
  upsertMyBreweryDashboardFundingDelivery,
);
router.patch(
  '/me/dashboard/fundings/:fundingId/orders/:orderId/delivery',
  authMiddleware,
  upsertMyBreweryDashboardFundingOrderDelivery,
);
router.get('/me/dashboard/insight', authMiddleware, getMyBreweryDashboardInsight);
router.post(
  '/me/dashboard/insight/payment/order',
  authMiddleware,
  createMyBreweryInsightPaymentOrder,
);
router.post(
  '/me/dashboard/insight/payment/toss/confirm',
  authMiddleware,
  confirmMyBreweryInsightTossPayment,
);
router.get(
  '/me/dashboard/insight/access',
  authMiddleware,
  getMyBreweryInsightAccess,
);
router.get('/me/dashboard/notifications', authMiddleware, getMyBreweryDashboardNotifications);

router.post('/accounts/verify', authMiddleware, verifyBreweryAccount);

router.post('/applications', authMiddleware, upload.single('businessLicense'), createBreweryApplication);
router.get('/applications', authMiddleware, requireAdmin, getBreweryApplications);
router.get('/applications/me', authMiddleware, getMyBreweryApplication);
router.patch('/applications/me', authMiddleware, updateMyApprovedBreweryApplication);
router.patch('/applications/:applicationId/approve', authMiddleware, requireAdmin, approveBreweryApplication);
router.patch('/applications/:applicationId/reject', authMiddleware, requireAdmin, rejectBreweryApplication);

module.exports = router;
