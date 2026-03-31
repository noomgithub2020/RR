const mysql = require("mysql2/promise");

exports.main = async function (event) {
  let connection;

  try {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      return {
        statusCode: 500,
        body: {
          ok: false,
          error: "DATABASE_URL is not set"
        }
      };
    }

    connection = await mysql.createConnection(databaseUrl);

    const [rows] = await connection.execute(
      "SELECT * FROM rangrod.payment LIMIT 10"
    );

    return {
      statusCode: 200,
      body: {
        ok: true,
        count: rows.length,
        data: rows
      }
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: {
        ok: false,
        error: error.message
      }
    };
  } finally {
    if (connection) {
      await connection.end();
    }
  }
};