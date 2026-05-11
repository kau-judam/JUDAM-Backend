const { Pool, types } = require('pg');

// DATE 컬럼(OID 1082)을 JS Date 객체로 변환하지 않고 'YYYY-MM-DD' 문자열 그대로 반환
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT),
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl:      { rejectUnauthorized: false },
});

module.exports = pool;
