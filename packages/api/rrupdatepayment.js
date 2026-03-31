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

function badRequest(message, debug = {}) {
  return {
    statusCode: 400,
    body: {
      ok: false,
      message,
      debug
    }
  };
}

exports.main = async function main(event) {
  let conn;
  const debug = {
    step: 'start',
    eventType: typeof event,
    hasBody: !!event?.body
  };

  try {
    const input = getInput(event);
    debug.step = 'input_parsed';
    debug.input = input;

    const tenantId = input.tenantId || input.tenantid;
    const rawAmount = input.amount;

    debug.tenantId = tenantId;
    debug.rawAmount = rawAmount;

    if (!tenantId || String(tenantId).trim() === '') {
      return badRequest('tenantId is required', debug);
    }

    if (rawAmount === undefined || rawAmount === null || rawAmount === '') {
      return badRequest('amount is required', debug);
    }

    const amount = Number(rawAmount);
    debug.amount = amount;
    debug.step = 'validation_done';

    if (!Number.isFinite(amount)) {
      return badRequest('amount must be numeric', debug);
    }

    if (![590, 3540].includes(amount)) {
      return badRequest('amount must be 590 or 3540', debug);
    }

    conn = await getPool().getConnection();
    debug.step = 'db_connected';

    await conn.beginTransaction();
    debug.step = 'tx_started';

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

    debug.step = 'tenant_lookup_done';
    debug.existingRowCount = existingRows.length;

    if (existingRows.length === 0) {
      await conn.rollback();
      debug.step = 'tenant_not_found';
      return badRequest('tenantId not found in rangrod.payment', debug);
    }

    const currentExpiredDate = existingRows[0].expiredDate;
    debug.currentExpiredDate = currentExpiredDate;

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

    debug.step = 'insert_done';
    debug.insertId = insertResult.insertId;

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
    debug.step = 'commit_done';

    return {
      statusCode: 201,
      body: {
        ok: true,
        message: 'payment inserted',
        debug,
        row: newRows[0]
      }
    };
  } catch (error) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {}
    }

    return {
      statusCode: 500,
      body: {
        ok: false,
        message: 'insert failed',
        debug,
        error: error.message,
        stack: error.stack
      }
    };
  } finally {
    if (conn) conn.release();
  }
};