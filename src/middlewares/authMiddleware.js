const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      status: 401,
      message: '유효하지 않거나 만료된 토큰입니다.',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { ...decoded, id: Number(decoded.id) };
    next();
  } catch (error) {
    return res.status(401).json({
      status: 401,
      message: '유효하지 않거나 만료된 토큰입니다.',
    });
  }
};

module.exports = authMiddleware;