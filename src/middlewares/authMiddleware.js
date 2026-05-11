const jwt = require('jsonwebtoken');

const sendUnauthorized = (res) => {
  return res.status(401).json({
    status: 401,
    message: '유효하지 않거나 만료된 토큰입니다.',
  });
};

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendUnauthorized(res);
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId || decoded.id;

    if (!userId) {
      return sendUnauthorized(res);
    }

    req.user = {
      ...decoded,
      userId,
      id: Number(userId),
    };

    next();
  } catch (error) {
    return sendUnauthorized(res);
  }
};

module.exports = authMiddleware;
