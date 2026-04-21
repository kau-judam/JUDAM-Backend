const createUser = async (userData) => {
  return {
    id: 1,
    email: userData.email,
    nickname: userData.nickname || 'judam-user',
  };
};

const loginUser = async (loginData) => {
  return {
    id: 1,
    email: loginData.email,
    nickname: 'judam-user',
  };
};

module.exports = { createUser, loginUser };