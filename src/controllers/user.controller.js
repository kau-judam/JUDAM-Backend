const {
  findUserById,
  updateUserProfile,
  deleteUserAccount,
  isNicknameExists,
} = require('../services/user.service');

const mapUserResponse = (user) => ({
  userId: String(user.user_id),
  email: user.email,
  nickname: user.nickname,
  role: user.role,
  provider: user.provider,
  profileImage: user.profile_image,
  lastLoginAt: user.last_login_at ? new Date(user.last_login_at).toISOString() : null,
});

const mapUpdatedUserResponse = (user) => ({
  userId: String(user.user_id),
  email: user.email,
  nickname: user.nickname,
  phoneNumber: user.phone_number,
  role: user.role,
  provider: user.provider,
  profileImage: user.profile_image,
  updatedAt: user.updated_at ? new Date(user.updated_at).toISOString() : null,
});

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

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

const updateMe = async (req, res) => {
  if (!req.user?.userId) {
    return res.status(401).json({
      status: 401,
      message: '유효하지 않거나 만료된 토큰입니다.',
    });
  }

  const body = req.body || {};
  const hasNickname = hasOwn(body, 'nickname');
  const hasPhoneNumber = hasOwn(body, 'phoneNumber');
  const hasProfileImage = hasOwn(body, 'profileImage');

  if (!hasNickname && !hasPhoneNumber && !hasProfileImage) {
    return res.status(400).json({
      message: 'no fields to update',
      error: 'at least one editable field is required',
    });
  }

  const updateData = {};

  if (hasNickname) {
    if (typeof body.nickname !== 'string' || body.nickname.trim() === '') {
      return res.status(400).json({
        message: 'invalid nickname',
        error: 'nickname cannot be empty',
      });
    }

    updateData.nickname = body.nickname.trim();
  }

  if (hasPhoneNumber) {
    updateData.phoneNumber = body.phoneNumber;
  }

  if (hasProfileImage) {
    updateData.profileImage = body.profileImage;
  }

  try {
    const user = await updateUserProfile(req.user.userId, updateData);

    return res.status(200).json({
      message: 'user profile updated',
      user: mapUpdatedUserResponse(user),
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({
        message: 'user not found',
        error: 'user does not exist',
      });
    }

    if (error.statusCode === 409) {
      return res.status(409).json({
        message: 'nickname already exists',
        error: 'duplicate nickname',
      });
    }

    return res.status(500).json({
      message: 'failed to update user',
      error: error.message,
    });
  }
};

const deleteMe = async (req, res) => {
  if (!req.user?.userId) {
    return res.status(401).json({
      status: 401,
      message: '유효하지 않거나 만료된 토큰입니다.',
    });
  }

  try {
    await deleteUserAccount(req.user.userId);

    return res.status(200).json({
      message: 'user deleted successfully',
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({
        message: 'user not found',
        error: 'user does not exist or already deleted',
      });
    }

    return res.status(500).json({
      message: 'failed to delete user',
      error: error.message,
    });
  }
};

const checkNickname = async (req, res) => {
  const nickname = typeof req.query.nickname === 'string' ? req.query.nickname.trim() : '';

  if (!nickname) {
    return res.status(400).json({
      message: 'nickname is required',
      error: 'nickname query parameter is missing',
    });
  }

  try {
    const exists = await isNicknameExists(nickname);

    return res.status(200).json({
      available: !exists,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'failed to check nickname',
      error: error.message,
    });
  }
};

module.exports = { getMe, updateMe, deleteMe, checkNickname };
