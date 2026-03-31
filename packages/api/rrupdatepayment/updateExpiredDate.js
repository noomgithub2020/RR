const mysql = require('mysql2/promise');

let pool;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = mysql.createPool(process.env.DATABASE_URL);
  }
  return pool;
}

function getInput(event) {
  if (!event) return {};

  // DigitalOcean often parses request input onto the top level event object.
  // This also supports JSON sent in event.body.
  let body = {};
  if (typeof event.body === 'string') {
    try {
      body = JSON.parse(event.body);
    } catch {
      body = {};
    }
  } else if (event.body && typeof event.body === 'object') {
    body = event.body;
  }

  return { ...event, ...body };
}

exports.main = async function main(event) {
  const input = getInput(event);

  const tenantId = input.tenantId || input.tenantid;
  const amount = Number(input.amount);

  if (!tenantId) {
    return {
      statusCode: 400,
      body: {
        ok: false,
        message: 'tenantId is required'
      }
    };
  }

  if (![590, 3540].includes(amount)) {
    return {
      statusCode: 400,
      body: {
        ok: false,
        message: 'amount must be 590 or 3540'
      }
    };
  }

  const conn = await getPool().getConnection();

  try {
    await conn.beginTransaction();

    // Validate tenantId exists in rangrod.payment and get the latest active expiredDate
    const [existingRows] = await conn.execute(
      `
      SELECT id, tenantId, expiredDate
      FROM rangrod.payment
      WHERE tenantId = ?
        AND deletedAt IS NULL
      ORDER BY expiredDate DESC, id DESC
      LIMIT 1
      FOR UPDATE
      `,
      [tenantId]
    );

    if (existingRows.length === 0) {
      await conn.rollback();
      return {
        statusCode: 400,
        body: {
          ok: false,
          message: 'tenantId not found in rangrod.payment'
        }
      };
    }

    const currentExpiredDate = existingRows[0].expiredDate;

    const [insertResult] = await conn.execute(
      `
      INSERT INTO rangrod.payment
      (
        createdAt,
        updatedAt,
        deletedAt,
        updatedBy,
        tenantId,
        paymentDate,
        expiredDate,
        amount,
        comment,
        photo
      )
      VALUES
      (
        NOW(),
        NOW(),
        NULL,
        'rrupdatepayment',
        ?,
        NOW(),
        CASE
          WHEN ? = 590 THEN
            CASE
              WHEN ? > NOW()
                THEN TIMESTAMP(DATE(DATE_ADD(?, INTERVAL 31 DAY)), '23:59:59')
              ELSE
                TIMESTAMP(DATE(DATE_ADD(NOW(), INTERVAL 31 DAY)), '23:59:59')
            END
          WHEN ? = 3540 THEN
            CASE
              WHEN ? > NOW()
                THEN TIMESTAMP(DATE(DATE_ADD(?, INTERVAL 216 DAY)), '23:59:59')
              ELSE
                TIMESTAMP(DATE(DATE_ADD(NOW(), INTERVAL 216 DAY)), '23:59:59')
            END
        END,
        ?,
        NULL,
        NULL
      )
      `,
      [
        tenantId,
        amount,
        currentExpiredDate,
        currentExpiredDate,
        amount,
        currentExpiredDate,
        currentExpiredDate,
        amount
      ]
    );

    const [newRows] = await conn.execute(
      `
      SELECT
        id,
        createdAt,
        updatedAt,
        deletedAt,
        updatedBy,
        tenantId,
        paymentDate,
        expiredDate,
        amount,
        comment,
        photo
      FROM rangrod.payment
      WHERE id = ?
      `,
      [insertResult.insertId]
    );

    await conn.commit();

    return {
      statusCode: 201,
      body: {
        ok: true,
        message: 'payment inserted',
        row: newRows[0]
      }
    };
  } catch (error) {
    await conn.rollback();
    console.error('rrupdatepayment failed', error);

    return {
      statusCode: 500,
      body: {
        ok: false,
        message: 'insert failed',
        error: error.message
      }
    };
  } finally {
    conn.release();
  }
};