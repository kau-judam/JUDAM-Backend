const pool = require('../db');

const createUser = async (userData) => {
  return {
    id: 1,
    email: userData.email,
    nickname: userData.nickname || 'judam-user',
  };
};

const loginUser = async (loginData) => {
  const result = await pool.query(
    'SELECT user_id AS id, email, nickname, role FROM users WHERE email = $1',
    [loginData.email]
  );

  if (result.rows.length === 0) {
    const error = new Error('존재하지 않는 이메일입니다.');
    error.statusCode = 401;
    throw error;
  }

  return result.rows[0];
};

module.exports = { createUser, loginUser };