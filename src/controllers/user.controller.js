const { findUserById } = require('../services/user.service');

const mapUserResponse = (user) => ({
  userId: String(user.user_id),
  email: user.email,
  nickname: user.nickname,
  role: user.role,
  provider: user.provider,
  profileImage: user.profile_image,
  lastLoginAt: user.last_login_at ? new Date(user.last_login_at).toISOString() : null,
});

const getMe = async (req, res) => {
  if (!req.user?.userId) {
    return res.status(401).json({
      status: 401,
      message: '유효하지 않거나 만료된 토큰입니다.',
    });
  }

  try {
    const user = await findUserById(req.user.userId);

    if (!user) {
      return res.status(404).json({
        message: 'user not found',
        error: 'user does not exist',
      });
    }

    return res.status(200).json({
      user: mapUserResponse(user),
    });
  } catch (error) {
    return res.status(500).json({
      message: 'failed to get user',
      error: error.message,
    });
  }
};

module.exports = { getMe };
