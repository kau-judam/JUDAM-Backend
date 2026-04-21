const login = (req, res) => {
  res.status(200).json({ message: 'login endpoint connected' });
};

const signup = (req, res) => {
  res.status(201).json({ message: 'signup endpoint connected' });
};

module.exports = { login, signup };