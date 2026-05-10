const breweryMiddleware = (req, res, next) => {
  if (req.user.role !== 'BREWERY') {
    return res.status(403).json({ status: 403, message: '양조장 계정만 사용할 수 있는 기능입니다.' });
  }
  next();
};

module.exports = breweryMiddleware;
