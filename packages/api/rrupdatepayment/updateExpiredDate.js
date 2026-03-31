const mysql = require('mysql2/promise');

function getDbConfig() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }

  const u = new URL(process.env.DATABASE_URL);

  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    ssl: {}
  };
}

exports.main = async function main() {
  let conn;

  try {
    const config = getDbConfig();

    conn = await mysql.createConnection(config);
    const [rows] = await conn.query('SELECT NOW() AS db_now, CURRENT_USER() AS db_user');

    return {
      statusCode: 200,
      body: {
        ok: true,
        message: 'database connection successful',
        row: rows[0]
      }
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: {
        ok: false,
        name: error.name,
        code: error.code,
        errno: error.errno,
        message: error.message,
        stack: error.stack
      }
    };
  } finally {
    if (conn) {
      await conn.end();
    }
  }
};