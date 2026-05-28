const {
  markBreweryNotificationRead,
  markAllBreweryNotificationsRead,
} = require('../services/brewery.service');

const getAuthenticatedUserId = (req) => {
  const userId = Number(req.user?.userId || req.user?.id);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
};

const sendError = (res, status, message, error) => {
  return res.status(status).json({
    status,
    message,
    error,
  });
};

const markNotificationRead = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  const notificationId = Number(req.params.notificationId);

  if (!userId) {
    return sendError(res, 401, '로그인이 필요합니다.', 'JWT payload의 userId가 없습니다.');
  }

  if (!Number.isInteger(notificationId) || notificationId <= 0) {
    return sendError(
      res,
      400,
      '알림 ID가 올바르지 않습니다.',
      'notificationId는 양의 정수여야 합니다.',
    );
  }

  try {
    const notification = await markBreweryNotificationRead({
      userId,
      notificationId,
    });

    return res.status(200).json(notification);
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '알림 읽음 처리에 실패했습니다.',
      error.detail || error.message,
    );
  }
};

const markAllNotificationsRead = async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return sendError(res, 401, '로그인이 필요합니다.', 'JWT payload의 userId가 없습니다.');
  }

  try {
    const result = await markAllBreweryNotificationsRead(userId);

    return res.status(200).json({
      ...result,
      message: '전체 알림을 읽음 처리했습니다.',
    });
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '전체 알림 읽음 처리에 실패했습니다.',
      error.detail || error.message,
    );
  }
};

module.exports = {
  markNotificationRead,
  markAllNotificationsRead,
};
