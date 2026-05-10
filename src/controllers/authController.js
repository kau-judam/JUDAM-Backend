const { createUser, loginUser } = require('../services/authService');
const { generateToken } = require('../utils/jwt');

const login = async (req, res) => {
  const user = await loginUser(req.body);

  const token = generateToken({
    id: user.id,
    email: user.email,
    role: user.role,
  });

  res.status(200).json({
    message: 'login success',
    data: user,
    token,
  });
};

const signup = async (req, res) => {
  const user = await createUser(req.body);

  const token = generateToken({
    id: user.id,
    email: user.email,
  });

  res.status(201).json({
    message: 'signup success',
    data: user,
    token,
  });
};

module.exports = { login, signup };