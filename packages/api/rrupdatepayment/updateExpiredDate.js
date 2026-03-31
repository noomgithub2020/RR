const mysql = require('mysql2/promise');

let pool;

function getPool() {
  console.log('[getPool] called');

  if (!pool) {
    console.log('[getPool] no existing pool, creating new pool');

    if (!process.env.DATABASE_URL) {
      console.error('[getPool] DATABASE_URL is not set');
      throw new Error('DATABASE_URL is not set');
    }

    pool = mysql.createPool(process.env.DATABASE_URL);
    console.log('[getPool] pool created successfully');
  } else {
    console.log('[getPool] reusing existing pool');
  }

  return pool;
}

function getInput(event) {
  console.log('[getInput] raw event:', JSON.stringify(event));

  if (!event) {
    console.warn('[getInput] event is empty, returning {}');
    return {};
  }

  let body = {};

  if (typeof event.body === 'string') {
    console.log('[getInput] event.body is string, attempting JSON.parse');
    try {
      body = JSON.parse(event.body);
      console.log('[getInput] parsed body successfully:', JSON.stringify(body));
    } catch (error) {
      console.error('[getInput] failed to parse event.body as JSON:', error.message);
      body = {};
    }
  } else if (event.body && typeof event.body === 'object') {
    console.log('[getInput] event.body is already object:', JSON.stringify(event.body));
    body = event.body;
  } else {
    console.log('[getInput] no usable body found');
  }

  const mergedInput = { ...event, ...body };
  console.log('[getInput] merged input:', JSON.stringify(mergedInput));

  return mergedInput;
}

function badRequest(message) {
  console.warn('[badRequest]', message);

  return {
    statusCode: 400,
    body: {
      ok: false,
      message
    }
  };
}

exports.main = async function main(event) {
  console.log('================ FUNCTION START ================');
  console.log('[main] function invoked at:', new Date().toISOString());

  let conn;

  try {
    const input = getInput(event);

    const tenantId = input.tenantId || input.tenantid;
    const rawAmount = input.amount;

    console.log('[main] extracted tenantId:', tenantId);
    console.log('[main] extracted rawAmount:', rawAmount);

    if (!tenantId || String(tenantId).trim() === '') {
      return badRequest('tenantId is required');
    }

    if (rawAmount === undefined || rawAmount === null || rawAmount === '') {
      return badRequest('amount is required');
    }

    const amount = Number(rawAmount);
    console.log('[main] converted amount:', amount);

    if (!Number.isFinite(amount)) {
      return badRequest('amount must be numeric');
    }

    if (![590, 3540].includes(amount)) {
      return badRequest('amount must be 590 or 3540');
    }

    console.log('[main] validation passed');

    conn = await getPool().getConnection();
    console.log('[main] database connection acquired');

    await conn.beginTransaction();
    console.log('[main] transaction started');

    const selectSql = `
      SELECT id, tenantId, expiredDate
      FROM rangrod.payment
      WHERE tenantId = ?
        AND deletedAt IS NULL
      ORDER BY expiredDate DESC, id DESC
      LIMIT 1
      FOR UPDATE
    `;

    console.log('[main] running tenant lookup query with tenantId:', tenantId);

    const [existingRows] = await conn.execute(selectSql, [tenantId]);

    console.log('[main] tenant lookup rows count:', existingRows.length);
    console.log('[main] tenant lookup rows:', JSON.stringify(existingRows));

    if (existingRows.length === 0) {
      console.warn('[main] tenantId not found, rolling back');
      await conn.rollback();
      console.log('[main] rollback completed');
      return badRequest('tenantId not found in rangrod.payment');
    }

    const currentExpiredDate = existingRows[0].expiredDate;
    console.log('[main] currentExpiredDate:', currentExpiredDate);

    const insertSql = `
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
    `;

    const insertParams = [
      tenantId,
      amount,
      currentExpiredDate,
      currentExpiredDate,
      amount,
      currentExpiredDate,
      currentExpiredDate,
      amount
    ];

    console.log('[main] running insert query');
    console.log('[main] insert params:', JSON.stringify(insertParams));

    const [insertResult] = await conn.execute(insertSql, insertParams);

    console.log('[main] insert successful');
    console.log('[main] insertResult:', JSON.stringify(insertResult));
    console.log('[main] new insertId:', insertResult.insertId);

    const selectNewRowSql = `
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
    `;

    console.log('[main] fetching inserted row by id:', insertResult.insertId);

    const [newRows] = await conn.execute(selectNewRowSql, [insertResult.insertId]);

    console.log('[main] inserted row fetch result:', JSON.stringify(newRows));

    await conn.commit();
    console.log('[main] transaction committed successfully');
    console.log('================ FUNCTION SUCCESS ================');

    return {
      statusCode: 201,
      body: {
        ok: true,
        message: 'payment inserted',
        row: newRows[0]
      }
    };
  } catch (error) {
    console.error('[main] rrupdatepayment failed');
    console.error('[main] error message:', error.message);
    console.error('[main] error stack:', error.stack);

    if (conn) {
      try {
        console.log('[main] attempting rollback');
        await conn.rollback();
        console.log('[main] rollback completed');
      } catch (rollbackError) {
        console.error('[main] rollback failed:', rollbackError.message);
      }
    }

    console.log('================ FUNCTION FAILED ================');

    return {
      statusCode: 500,
      body: {
        ok: false,
        message: 'insert failed',
        error: error.message
      }
    };
  } finally {
    if (conn) {
      try {
        conn.release();
        console.log('[main] database connection released');
      } catch (releaseError) {
        console.error('[main] failed to release connection:', releaseError.message);
      }
    }

    console.log('================ FUNCTION END ================');
  }
};