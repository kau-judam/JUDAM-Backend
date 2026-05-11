const jwt = require('jsonwebtoken');

const optionalAuthMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = { ...decoded, id: Number(decoded.id) };
    } catch (_) {
      req.user = null;
    }
  } else {
    req.user = null;
  }

  next();
};

module.exports = optionalAuthMiddleware;
