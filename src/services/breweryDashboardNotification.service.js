const pool = require('../config/db');

const FUNDING_PROGRESS_THRESHOLDS = [30, 50, 80];
const RECIPE_POPULAR_INTEREST_THRESHOLD = 30;

const parseImageUrls = (value) => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (error) {
      return value.trim() ? [value.trim()] : [];
    }
  }

  return [];
};

const getQueryRunner = (client) => client || pool;

const mapNotification = (row) => {
  if (!row) {
    return null;
  }

  return {
    notificationId: Number(row.notification_id),
    userId: Number(row.user_id),
    type: row.type,
    title: row.title,
    content: row.content,
    linkUrl: row.link_url || null,
    imageUrl: row.image_url || null,
    isRead: Boolean(row.is_read),
    createdAt: row.created_at,
    eventKey: row.event_key || null,
    fundingId: row.funding_id === null || row.funding_id === undefined
      ? null
      : Number(row.funding_id),
    recipeId: row.recipe_id === null || row.recipe_id === undefined
      ? null
      : Number(row.recipe_id),
    progressThreshold: row.progress_threshold === null || row.progress_threshold === undefined
      ? null
      : Number(row.progress_threshold),
    metadata: row.metadata || {},
  };
};

const createBreweryDashboardNotification = async ({
  userId,
  type,
  title,
  content,
  linkUrl,
  imageUrl,
  eventKey = null,
  fundingId = null,
  recipeId = null,
  progressThreshold = null,
  metadata = {},
  client = null,
}) => {
  const numericUserId = Number(userId);

  if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
    return null;
  }

  const queryRunner = getQueryRunner(client);
  const { rows } = await queryRunner.query(
    `
    INSERT INTO brewery_dashboard_notifications (
      user_id,
      type,
      title,
      content,
      link_url,
      image_url,
      event_key,
      funding_id,
      recipe_id,
      progress_threshold,
      metadata,
      is_read,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT DO NOTHING
    RETURNING
      notification_id,
      user_id,
      type,
      title,
      content,
      link_url,
      image_url,
      is_read,
      created_at,
      event_key,
      funding_id,
      recipe_id,
      progress_threshold,
      metadata
    `,
    [
      numericUserId,
      type,
      title,
      content || null,
      linkUrl || null,
      imageUrl || null,
      eventKey || null,
      fundingId === null || fundingId === undefined ? null : Number(fundingId),
      recipeId === null || recipeId === undefined ? null : Number(recipeId),
      progressThreshold === null || progressThreshold === undefined
        ? null
        : Number(progressThreshold),
      JSON.stringify(metadata || {}),
    ],
  );

  return mapNotification(rows[0] || null);
};

const getFundingNotificationSource = async (fundingId, client = null) => {
  const queryRunner = getQueryRunner(client);
  const { rows } = await queryRunner.query(
    `
    SELECT
      fp.funding_id,
      fp.brewery_user_id,
      fp.title,
      fp.thumbnail_url,
      fp.image_urls,
      fp.goal_amount,
      fp.current_amount,
      r.image_url AS recipe_image_url
    FROM funding_projects fp
    LEFT JOIN recipes r ON r.recipe_id = fp.recipe_id
    WHERE fp.funding_id = $1
    LIMIT 1
    `,
    [Number(fundingId)],
  );

  if (rows.length === 0) {
    return null;
  }

  const funding = rows[0];
  const imageUrl = funding.thumbnail_url
    || parseImageUrls(funding.image_urls)[0]
    || funding.recipe_image_url
    || null;
  const currentAmount = Number(funding.current_amount || 0);
  const targetAmount = Number(funding.goal_amount || 0);

  return {
    fundingId: Number(funding.funding_id),
    breweryUserId: Number(funding.brewery_user_id),
    title: funding.title || '펀딩',
    imageUrl,
    currentAmount,
    targetAmount,
    achievementRate: targetAmount > 0
      ? Math.floor((currentAmount / targetAmount) * 100)
      : 0,
  };
};

const createFundingCreatedNotification = async (fundingId, options = {}) => {
  const funding = await getFundingNotificationSource(fundingId, options.client);

  if (!funding || !funding.breweryUserId) {
    return null;
  }

  return createBreweryDashboardNotification({
    userId: funding.breweryUserId,
    type: 'FUNDING_CREATED',
    title: '새 펀딩이 등록되었습니다.',
    content: `'${funding.title}' 펀딩이 새롭게 등록되었습니다.`,
    linkUrl: `/funding/${funding.fundingId}`,
    imageUrl: funding.imageUrl,
    eventKey: `funding:${funding.fundingId}:created`,
    fundingId: funding.fundingId,
    metadata: {
      fundingId: funding.fundingId,
      title: funding.title,
    },
    client: options.client,
  });
};

const createFundingProgressNotification = async (fundingId, threshold, options = {}) => {
  const numericThreshold = Number(threshold);

  if (!FUNDING_PROGRESS_THRESHOLDS.includes(numericThreshold)) {
    return null;
  }

  const funding = await getFundingNotificationSource(fundingId, options.client);

  if (!funding || !funding.breweryUserId || funding.achievementRate < numericThreshold) {
    return null;
  }

  return createBreweryDashboardNotification({
    userId: funding.breweryUserId,
    type: 'FUNDING_PROGRESS',
    title: '펀딩 진행 상황',
    content: `'${funding.title}' 펀딩이 목표 금액 ${numericThreshold}%를 달성했습니다.`,
    linkUrl: `/funding/${funding.fundingId}`,
    imageUrl: funding.imageUrl,
    eventKey: `funding:${funding.fundingId}:progress:${numericThreshold}`,
    fundingId: funding.fundingId,
    progressThreshold: numericThreshold,
    metadata: {
      fundingId: funding.fundingId,
      title: funding.title,
      currentAmount: funding.currentAmount,
      targetAmount: funding.targetAmount,
      achievementRate: funding.achievementRate,
      threshold: numericThreshold,
    },
    client: options.client,
  });
};

const createFundingProgressNotificationsForReachedThresholds = async (fundingId, options = {}) => {
  const funding = await getFundingNotificationSource(fundingId, options.client);

  if (!funding || !funding.breweryUserId || funding.targetAmount <= 0) {
    return [];
  }

  const created = [];

  for (const threshold of FUNDING_PROGRESS_THRESHOLDS) {
    if (funding.achievementRate >= threshold) {
      const notification = await createFundingProgressNotification(funding.fundingId, threshold, {
        client: options.client,
      });

      if (notification) {
        created.push(notification);
      }
    }
  }

  return created;
};

const createFundingEndedNotification = async (fundingId, options = {}) => {
  const funding = await getFundingNotificationSource(fundingId, options.client);

  if (!funding || !funding.breweryUserId) {
    return null;
  }

  return createBreweryDashboardNotification({
    userId: funding.breweryUserId,
    type: 'FUNDING_ENDED',
    title: '펀딩이 종료되었습니다.',
    content: `'${funding.title}' 펀딩이 종료되었습니다.`,
    linkUrl: `/funding/${funding.fundingId}`,
    imageUrl: funding.imageUrl,
    eventKey: `funding:${funding.fundingId}:ended`,
    fundingId: funding.fundingId,
    metadata: {
      fundingId: funding.fundingId,
      title: funding.title,
      currentAmount: funding.currentAmount,
      targetAmount: funding.targetAmount,
      achievementRate: funding.achievementRate,
    },
    client: options.client,
  });
};

const createFundingSuccessNotification = async (fundingId, options = {}) => {
  const funding = await getFundingNotificationSource(fundingId, options.client);

  if (!funding || !funding.breweryUserId) {
    return null;
  }

  return createBreweryDashboardNotification({
    userId: funding.breweryUserId,
    type: 'FUNDING_SUCCESS',
    title: '펀딩이 성공했습니다.',
    content: `'${funding.title}' 펀딩이 목표 금액을 달성하여 성공했습니다.`,
    linkUrl: `/funding/${funding.fundingId}`,
    imageUrl: funding.imageUrl,
    eventKey: `funding:${funding.fundingId}:success`,
    fundingId: funding.fundingId,
    metadata: {
      fundingId: funding.fundingId,
      title: funding.title,
      currentAmount: funding.currentAmount,
      targetAmount: funding.targetAmount,
      achievementRate: funding.achievementRate,
    },
    client: options.client,
  });
};

const createRecipePopularNotification = async (recipeId, options = {}) => {
  const queryRunner = getQueryRunner(options.client);
  const { rows: recipeRows } = await queryRunner.query(
    `
    SELECT
      recipe_id,
      title,
      image_url,
      interest_count
    FROM recipes
    WHERE recipe_id = $1
    LIMIT 1
    `,
    [Number(recipeId)],
  );

  if (recipeRows.length === 0) {
    return [];
  }

  const recipe = recipeRows[0];
  const interestCount = Number(recipe.interest_count || 0);

  if (interestCount < RECIPE_POPULAR_INTEREST_THRESHOLD) {
    return [];
  }

  const { rows: breweryUsers } = await queryRunner.query(
    `
    SELECT DISTINCT ba.user_id
    FROM brewery_auth ba
    JOIN users u ON u.user_id = ba.user_id
    WHERE ba.status = 'APPROVED'
      AND u.deleted_at IS NULL
    `,
  );

  const created = [];

  for (const breweryUser of breweryUsers) {
    const notification = await createBreweryDashboardNotification({
      userId: breweryUser.user_id,
      type: 'RECIPE_POPULAR',
      title: '새로운 인기 레시피 등장',
      content: `'${recipe.title || '레시피'}' 레시피가 현재 많은 관심을 받고 있습니다.`,
      linkUrl: `/recipe/${Number(recipe.recipe_id)}`,
      imageUrl: recipe.image_url || null,
      eventKey: `recipe:${Number(recipe.recipe_id)}:popular`,
      recipeId: Number(recipe.recipe_id),
      metadata: {
        recipeId: Number(recipe.recipe_id),
        title: recipe.title || null,
        interestCount,
        threshold: RECIPE_POPULAR_INTEREST_THRESHOLD,
      },
      client: options.client,
    });

    if (notification) {
      created.push(notification);
    }
  }

  return created;
};

module.exports = {
  FUNDING_PROGRESS_THRESHOLDS,
  RECIPE_POPULAR_INTEREST_THRESHOLD,
  createBreweryDashboardNotification,
  createFundingCreatedNotification,
  createFundingProgressNotification,
  createFundingProgressNotificationsForReachedThresholds,
  createFundingEndedNotification,
  createFundingSuccessNotification,
  createRecipePopularNotification,
};
