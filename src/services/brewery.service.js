const path = require('path');
const pool = require('../config/db');
const { uploadFileToS3 } = require('./s3.service');

const MAX_BUSINESS_LICENSE_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_BUSINESS_LICENSE_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
const ALLOWED_BUSINESS_LICENSE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

const mapApplication = (row) => ({
  applicationId: row.application_id,
  userId: row.user_id,
  breweryName: row.brewery_name,
  businessNumber: row.license_number,
  licenseNumber: row.license_number,
  businessAddress: row.location ?? null,
  location: row.location ?? null,
  businessAddressDetail: row.business_address_detail ?? null,
  phoneNumber: row.phone_number ?? null,
  documentUrl: row.document_url,
  documentKey: row.document_key,
  originalName: row.original_name ?? null,
  mimeType: row.mime_type ?? null,
  fileSize: row.file_size === null || row.file_size === undefined ? null : Number(row.file_size),
  rejectReason: row.reject_reason,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapUserResponse = (row) => ({
  userId: String(row.user_id),
  email: row.email,
  nickname: row.nickname,
  phoneNumber: row.phone_number,
  provider: row.provider,
  role: row.role,
  profileImage: row.profile_image,
});

const createServiceError = (statusCode, message, detail) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.detail = detail;
  return error;
};

const validateBusinessLicenseFile = (file) => {
  if (!file) {
    return;
  }

  const extension = path.extname(file.originalname || '').toLowerCase();

  if (
    !ALLOWED_BUSINESS_LICENSE_EXTENSIONS.has(extension)
    || !ALLOWED_BUSINESS_LICENSE_MIME_TYPES.has(file.mimetype)
  ) {
    throw createServiceError(
      400,
      '사업자등록증 파일 형식이 올바르지 않습니다.',
      'businessLicense는 pdf, jpg, jpeg, png 파일만 업로드할 수 있습니다.',
    );
  }

  if (file.size > MAX_BUSINESS_LICENSE_FILE_SIZE) {
    throw createServiceError(
      400,
      '사업자등록증 파일은 최대 10MB까지 업로드할 수 있습니다.',
      `file_size=${file.size}`,
    );
  }
};

const extractS3KeyFromUrl = (fileUrl) => {
  if (!fileUrl) {
    return null;
  }

  try {
    return decodeURIComponent(new URL(fileUrl).pathname.replace(/^\/+/, ''));
  } catch (error) {
    const marker = '.amazonaws.com/';
    return fileUrl.includes(marker) ? fileUrl.split(marker)[1] : null;
  }
};

const createApplication = async ({
  userId,
  breweryName,
  licenseNumber,
  location,
  businessAddressDetail,
  phoneNumber,
  businessLicenseFile,
  documentUrl,
  documentKey,
}) => {
  validateBusinessLicenseFile(businessLicenseFile);

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

  let uploadedDocumentUrl = documentUrl || null;
  let uploadedDocumentKey = documentKey || null;
  let originalName = null;
  let mimeType = null;
  let fileSize = null;

  if (businessLicenseFile) {
    uploadedDocumentUrl = await uploadFileToS3(
      businessLicenseFile.buffer,
      businessLicenseFile.originalname,
      businessLicenseFile.mimetype,
      userId,
    );
    uploadedDocumentKey = extractS3KeyFromUrl(uploadedDocumentUrl);
    originalName = businessLicenseFile.originalname;
    mimeType = businessLicenseFile.mimetype;
    fileSize = businessLicenseFile.size;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
        INSERT INTO brewery_auth (
          user_id,
          license_number,
          status,
          location,
          brewery_name,
          business_address_detail,
          phone_number,
          document_url,
          document_key,
          original_name,
          mime_type,
          file_size,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          'APPROVED',
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        RETURNING
          application_id,
          user_id,
          brewery_name,
          license_number,
          location,
          business_address_detail,
          phone_number,
          document_url,
          document_key,
          original_name,
          mime_type,
          file_size,
          reject_reason,
          status,
          created_at,
          updated_at
      `,
      [
        userId,
        licenseNumber,
        location || null,
        breweryName,
        businessAddressDetail || null,
        phoneNumber,
        uploadedDocumentUrl,
        uploadedDocumentKey,
        originalName,
        mimeType,
        fileSize,
      ],
    );

    const userResult = await client.query(
      `
        UPDATE users
        SET
          role = 'BREWERY',
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
          AND deleted_at IS NULL
        RETURNING
          user_id,
          email,
          nickname,
          phone_number,
          provider,
          role,
          profile_image
      `,
      [userId],
    );

    if (userResult.rows.length === 0) {
      throw createServiceError(404, '사용자를 찾을 수 없습니다.', `user_id=${userId}`);
    }

    await client.query('COMMIT');

    return {
      ...mapApplication(rows[0]),
      user: mapUserResponse(userResult.rows[0]),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
        location,
        business_address_detail,
        phone_number,
        document_url,
        document_key,
        original_name,
        mime_type,
        file_size,
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
        location,
        business_address_detail,
        phone_number,
        document_url,
        document_key,
        original_name,
        mime_type,
        file_size,
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
        SET
          role = 'BREWERY',
          updated_at = CURRENT_TIMESTAMP
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
        location,
        business_address_detail,
        phone_number,
        document_url,
        document_key,
        original_name,
        mime_type,
        file_size,
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
      '양조장 인증 신청을 찾을 수 없습니다.',
      `application_id=${applicationId}`,
    );
  }

  return mapApplication(rows[0]);
};

const updateApprovedApplicationByUserId = async ({
  userId,
  breweryName,
  licenseNumber,
  location,
  documentUrl,
  documentKey,
}) => {
  const updates = [];
  const values = [userId];

  const addUpdate = (column, value) => {
    if (value === undefined) {
      return;
    }

    values.push(value);
    updates.push(`${column} = $${values.length}`);
  };

  addUpdate('brewery_name', breweryName);
  addUpdate('license_number', licenseNumber);
  addUpdate('location', location);
  addUpdate('document_url', documentUrl);
  addUpdate('document_key', documentKey);

  if (updates.length === 0) {
    throw createServiceError(
      400,
      '수정할 양조장 정보가 없습니다.',
      'breweryName, licenseNumber, location, documentUrl, documentKey 중 하나 이상 필요합니다.',
    );
  }

  const { rows } = await pool.query(
    `
      UPDATE brewery_auth
      SET
        ${updates.join(', ')},
        updated_at = CURRENT_TIMESTAMP
      WHERE application_id = (
        SELECT application_id
        FROM brewery_auth
        WHERE user_id = $1
          AND status = 'APPROVED'
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      )
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
    values,
  );

  if (rows.length === 0) {
    throw createServiceError(
      404,
      '승인된 양조장 인증 정보를 찾을 수 없습니다.',
      `user_id=${userId}`,
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
  updateApprovedApplicationByUserId,
};
