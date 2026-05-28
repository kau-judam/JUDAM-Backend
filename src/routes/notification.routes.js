const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');
const {
  markNotificationRead,
  markAllNotificationsRead,
} = require('../controllers/notification.controller');

const router = express.Router();

router.patch('/read-all', authMiddleware, markAllNotificationsRead);
router.patch('/:notificationId/read', authMiddleware, markNotificationRead);

module.exports = router;
