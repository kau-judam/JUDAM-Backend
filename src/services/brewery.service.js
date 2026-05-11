const pool = require('../config/db');

const mapApplication = (row) => ({
  applicationId: row.application_id,
  userId: row.user_id,
  breweryName: row.brewery_name,
  licenseNumber: row.license_number,
  location: row.location ?? null,
  documentUrl: row.document_url,
  documentKey: row.document_key,
  rejectReason: row.reject_reason,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const createServiceError = (statusCode, message, detail) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.detail = detail;
  return error;
};

const createApplication = async ({ userId, breweryName, licenseNumber, location, documentUrl, documentKey }) => {
  const existingApplication = await pool.query(
    `
      SELECT application_id, status
      FROM brewery_auth
      WHERE user_id = $1
        AND status = 'PENDING'
      LIMIT 1
    `,
    [userId],
  );

  if (existingApplication.rows.length > 0) {
    throw createServiceError(
      409,
      '이미 진행 중인 양조장 인증 신청이 있습니다.',
      `application_id=${existingApplication.rows[0].application_id}, status=${existingApplication.rows[0].status}`,
    );
  }

  const { rows } = await pool.query(
    `
      INSERT INTO brewery_auth (
        user_id,
        license_number,
        status,
        location,
        brewery_name,
        document_url,
        document_key,
        created_at,
        updated_at
      )
      VALUES ($1, $2, 'PENDING', $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING
        application_id,
        user_id,
        brewery_name,
        license_number,
        location AS location,
        document_url,
        document_key,
        reject_reason,
        status,
        created_at,
        updated_at
    `,
    [userId, licenseNumber, location || null, breweryName, documentUrl, documentKey || null],
  );

  return mapApplication(rows[0]);
};

const getApplications = async ({ status } = {}) => {
  const values = [];
  const whereClause = status ? 'WHERE status = $1' : '';

  if (status) {
    values.push(status);
  }

  const { rows } = await pool.query(
    `
      SELECT
        application_id,
        user_id,
        brewery_name,
        license_number,
        location AS location,
        document_url,
        document_key,
        reject_reason,
        status,
        created_at,
        updated_at
      FROM brewery_auth
      ${whereClause}
      ORDER BY created_at DESC
    `,
    values,
  );

  return rows.map(mapApplication);
};

const getApplicationByUserId = async (userId) => {
  const { rows } = await pool.query(
    `
      SELECT
        application_id,
        user_id,
        brewery_name,
        license_number,
        location AS location,
        document_url,
        document_key,
        reject_reason,
        status,
        created_at,
        updated_at
      FROM brewery_auth
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [userId],
  );

  if (rows.length === 0) {
    throw createServiceError(
      404,
      '양조장 인증 신청 내역을 찾을 수 없습니다.',
      `user_id=${userId}`,
    );
  }

  return mapApplication(rows[0]);
};

const approveApplication = async (applicationId) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const applicationResult = await client.query(
      `
        UPDATE brewery_auth
        SET
          status = 'APPROVED',
          updated_at = CURRENT_TIMESTAMP
        WHERE application_id = $1
        RETURNING application_id, user_id, status
      `,
      [applicationId],
    );

    if (applicationResult.rows.length === 0) {
      throw createServiceError(
        404,
        '양조장 인증 신청을 찾을 수 없습니다.',
        `application_id=${applicationId}`,
      );
    }

    const application = applicationResult.rows[0];

    const userResult = await client.query(
      `
        UPDATE users
        SET role = 'BREWERY'
        WHERE user_id = $1
        RETURNING user_id, role
      `,
      [application.user_id],
    );

    if (userResult.rows.length === 0) {
      throw createServiceError(
        404,
        '양조장 인증 신청에 연결된 사용자를 찾을 수 없습니다.',
        `user_id=${application.user_id}`,
      );
    }

    await client.query('COMMIT');

    return {
      applicationId: application.application_id,
      userId: application.user_id,
      status: application.status,
      role: userResult.rows[0].role,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const rejectApplication = async ({ applicationId, rejectReason }) => {
  const { rows } = await pool.query(
    `
      UPDATE brewery_auth
      SET
        status = 'REJECTED',
        reject_reason = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE application_id = $1
      RETURNING
        application_id,
        user_id,
        brewery_name,
        license_number,
        location AS location,
        document_url,
        document_key,
        reject_reason,
        status,
        created_at,
        updated_at
    `,
    [applicationId, rejectReason],
  );

  if (rows.length === 0) {
    throw createServiceError(
      404,
      '?묒“???몄쬆 ?좎껌??李얠쓣 ???놁뒿?덈떎.',
      `application_id=${applicationId}`,
    );
  }

  return mapApplication(rows[0]);
};

module.exports = {
  createApplication,
  getApplications,
  getApplicationByUserId,
  approveApplication,
  rejectApplication,
};
