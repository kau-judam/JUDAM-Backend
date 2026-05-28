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

const mapBreweryProfile = (row) => ({
  profileImageUrl: row.profile_image_url || null,
  breweryName: row.brewery_name || null,
  oneLineIntroduction: row.one_line_introduction || null,
  shortIntroduction: row.short_introduction || null,
  brandStory: row.brand_story || null,
  history: row.history || null,
  establishedYear: row.established_year === null || row.established_year === undefined
    ? null
    : Number(row.established_year),
  representativeName: row.representative_name || null,
  address: row.profile_address || row.location || null,
  businessRegistrationNumber: row.license_number || null,
  phoneNumber: row.phone_number || row.user_phone_number || null,
  email: row.contact_email || row.user_email || null,
  isVerified: row.status === 'APPROVED',
});

const mapBreweryDashboardBasicInfo = (row) => ({
  breweryName: row.brewery_name || null,
  profileImageUrl: row.profile_image_url || null,
  address: row.profile_address || row.location || null,
  addressDetail: row.business_address_detail || null,
});

const mapBreweryNotification = (row) => ({
  notificationId: Number(row.notification_id),
  type: row.type,
  title: row.title,
  content: row.content,
  createdAt: row.created_at,
  isRead: Boolean(row.is_read),
  linkUrl: row.link_url || null,
  imageUrl: row.image_url || null,
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
        AND status IN ('PENDING', 'APPROVED')
      ORDER BY
        CASE WHEN status = 'PENDING' THEN 0 ELSE 1 END,
        updated_at DESC NULLS LAST,
        created_at DESC
      LIMIT 1
    `,
    [userId],
  );

  const existing = existingApplication.rows[0] || null;

  if (existing?.status === 'APPROVED') {
    const userResult = await pool.query(
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
      throw createServiceError(404, '?ъ슜?먮? 李얠쓣 ???놁뒿?덈떎.', `user_id=${userId}`);
    }

    return {
      ...mapApplication(existing),
      user: mapUserResponse(userResult.rows[0]),
    };
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

  if (existing?.status === 'PENDING') {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `
          UPDATE brewery_auth
          SET
            license_number = $1,
            status = 'APPROVED',
            location = $2,
            brewery_name = $3,
            business_address_detail = $4,
            phone_number = $5,
            document_url = $6,
            document_key = $7,
            original_name = $8,
            mime_type = $9,
            file_size = $10,
            reject_reason = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE application_id = $11
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
          existing.application_id,
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
        throw createServiceError(404, '?ъ슜?먮? 李얠쓣 ???놁뒿?덈떎.', `user_id=${userId}`);
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

const assertBreweryDashboardUser = async (userId) => {
  const { rows } = await pool.query(
    `
      SELECT
        u.user_id,
        u.role,
        EXISTS (
          SELECT 1
          FROM brewery_auth ba
          WHERE ba.user_id = u.user_id
            AND ba.status = 'APPROVED'
        ) AS has_approved_brewery
      FROM users u
      WHERE u.user_id = $1
        AND u.deleted_at IS NULL
      LIMIT 1
    `,
    [userId],
  );

  if (rows.length === 0) {
    throw createServiceError(404, '사용자를 찾을 수 없습니다.', `user_id=${userId}`);
  }

  const role = String(rows[0].role || '').toUpperCase();

  if (!role.startsWith('BREWERY') && !rows[0].has_approved_brewery) {
    throw createServiceError(
      403,
      '양조장 계정만 사용할 수 있는 기능입니다.',
      `user_id=${userId}`,
    );
  }

  return rows[0];
};

const getBreweryProfileByUserId = async (userId) => {
  await assertBreweryDashboardUser(userId);

  const { rows } = await pool.query(
    `
      SELECT
        ba.application_id,
        ba.user_id,
        COALESCE(bp.brewery_name, ba.brewery_name) AS brewery_name,
        ba.license_number,
        ba.status,
        ba.location,
        ba.phone_number,
        bp.profile_image_url,
        bp.one_line_introduction,
        bp.short_introduction,
        bp.brand_story,
        bp.history,
        bp.established_year,
        bp.representative_name,
        bp.address AS profile_address,
        bp.contact_email,
        u.email AS user_email,
        u.phone_number AS user_phone_number,
        u.profile_image AS user_profile_image
      FROM brewery_auth ba
      JOIN users u ON u.user_id = ba.user_id
      LEFT JOIN brewery_profiles bp ON bp.user_id = ba.user_id
      WHERE ba.user_id = $1
        AND ba.status = 'APPROVED'
      ORDER BY ba.updated_at DESC, ba.created_at DESC
      LIMIT 1
    `,
    [userId],
  );

  if (rows.length === 0) {
    throw createServiceError(
      404,
      '승인된 양조장 프로필을 찾을 수 없습니다.',
      `user_id=${userId}`,
    );
  }

  return mapBreweryProfile(rows[0]);
};

const getBreweryDashboardBasicInfoByUserId = async (userId) => {
  await assertBreweryDashboardUser(userId);

  const { rows } = await pool.query(
    `
      SELECT
        COALESCE(bp.brewery_name, ba.brewery_name) AS brewery_name,
        bp.profile_image_url,
        ba.location,
        bp.address AS profile_address,
        ba.business_address_detail
      FROM brewery_auth ba
      LEFT JOIN brewery_profiles bp ON bp.user_id = ba.user_id
      WHERE ba.user_id = $1
        AND ba.status = 'APPROVED'
      ORDER BY ba.updated_at DESC, ba.created_at DESC
      LIMIT 1
    `,
    [userId],
  );

  if (rows.length === 0) {
    throw createServiceError(
      404,
      '승인된 양조장 기본 정보를 찾을 수 없습니다.',
      `user_id=${userId}`,
    );
  }

  return mapBreweryDashboardBasicInfo(rows[0]);
};

const updateBreweryProfileByUserId = async ({ userId, profile }) => {
  await assertBreweryDashboardUser(userId);

  const columns = ['user_id', 'application_id'];
  const selectValues = ['$1', 'latest_application.application_id'];
  const updateAssignments = ['application_id = EXCLUDED.application_id'];
  const values = [userId];

  const addProfileValue = (column, value) => {
    if (value === undefined) {
      return;
    }

    values.push(value);
    columns.push(column);
    selectValues.push(`$${values.length}`);
    updateAssignments.push(`${column} = EXCLUDED.${column}`);
  };

  addProfileValue('profile_image_url', profile.profileImageUrl);
  addProfileValue('brewery_name', profile.breweryName);
  addProfileValue('one_line_introduction', profile.oneLineIntroduction);
  addProfileValue('short_introduction', profile.shortIntroduction);
  addProfileValue('brand_story', profile.brandStory);
  addProfileValue('history', profile.history);
  addProfileValue('established_year', profile.establishedYear);
  addProfileValue('representative_name', profile.representativeName);
  addProfileValue('address', profile.address);
  addProfileValue('contact_email', profile.email);

  if (columns.length === 2) {
    throw createServiceError(
      400,
      '수정할 양조장 프로필 정보가 없습니다.',
      'profileImageUrl, breweryName, oneLineIntroduction, shortIntroduction, brandStory, history, establishedYear, representativeName, address, email 중 하나 이상 필요합니다.',
    );
  }

  const { rows } = await pool.query(
    `
      WITH latest_application AS (
        SELECT
          application_id,
          user_id
        FROM brewery_auth
        WHERE user_id = $1
          AND status = 'APPROVED'
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      ),
      upserted AS (
        INSERT INTO brewery_profiles (
          ${columns.join(', ')}
        )
        SELECT
          ${selectValues.join(', ')}
        FROM latest_application
        ON CONFLICT (user_id) DO UPDATE
        SET
          ${updateAssignments.join(', ')},
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      )
      SELECT
        ba.application_id,
        ba.user_id,
        COALESCE(upserted.brewery_name, ba.brewery_name) AS brewery_name,
        ba.license_number,
        ba.status,
        ba.location,
        ba.phone_number,
        upserted.profile_image_url,
        upserted.one_line_introduction,
        upserted.short_introduction,
        upserted.brand_story,
        upserted.history,
        upserted.established_year,
        upserted.representative_name,
        upserted.address AS profile_address,
        upserted.contact_email,
        u.email AS user_email,
        u.phone_number AS user_phone_number,
        u.profile_image AS user_profile_image
      FROM upserted
      JOIN brewery_auth ba ON ba.application_id = upserted.application_id
      JOIN users u ON u.user_id = upserted.user_id
    `,
    values,
  );

  if (rows.length === 0) {
    throw createServiceError(
      404,
      '승인된 양조장 프로필을 찾을 수 없습니다.',
      `user_id=${userId}`,
    );
  }

  return mapBreweryProfile(rows[0]);
};

const getBreweryNotificationsByUserId = async (userId) => {
  await assertBreweryDashboardUser(userId);

  const { rows } = await pool.query(
    `
      SELECT
        notification_id,
        user_id,
        type,
        title,
        content,
        link_url,
        image_url,
        is_read,
        created_at
      FROM brewery_dashboard_notifications
      WHERE user_id = $1
      ORDER BY created_at DESC, notification_id DESC
    `,
    [userId],
  );

  return rows.map(mapBreweryNotification);
};

const markBreweryNotificationRead = async ({ userId, notificationId }) => {
  await assertBreweryDashboardUser(userId);

  const { rows } = await pool.query(
    `
      UPDATE brewery_dashboard_notifications
      SET
        is_read = TRUE,
        read_at = COALESCE(read_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
      WHERE notification_id = $1
        AND user_id = $2
      RETURNING
        notification_id,
        type,
        title,
        content,
        link_url,
        image_url,
        is_read,
        created_at
    `,
    [notificationId, userId],
  );

  if (rows.length === 0) {
    throw createServiceError(
      404,
      '알림을 찾을 수 없습니다.',
      `notification_id=${notificationId}, user_id=${userId}`,
    );
  }

  return mapBreweryNotification(rows[0]);
};

const markAllBreweryNotificationsRead = async (userId) => {
  await assertBreweryDashboardUser(userId);

  const { rows } = await pool.query(
    `
      UPDATE brewery_dashboard_notifications
      SET
        is_read = TRUE,
        read_at = COALESCE(read_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
        AND is_read = FALSE
      RETURNING notification_id
    `,
    [userId],
  );

  return {
    updatedCount: rows.length,
  };
};

module.exports = {
  createApplication,
  getApplications,
  getApplicationByUserId,
  approveApplication,
  rejectApplication,
  updateApprovedApplicationByUserId,
  getBreweryProfileByUserId,
  getBreweryDashboardBasicInfoByUserId,
  updateBreweryProfileByUserId,
  getBreweryNotificationsByUserId,
  markBreweryNotificationRead,
  markAllBreweryNotificationsRead,
};
