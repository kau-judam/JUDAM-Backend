const pool = require('../config/db');
const {
  createFundingEndedNotification,
  createFundingSuccessNotification,
} = require('./breweryDashboardNotification.service');

const SETTLE_CANDIDATE_STATUSES = ['ACTIVE', 'ONGOING'];

const mapSettledFunding = (row) => ({
  fundingId: Number(row.funding_id),
  title: row.title,
  previousStatus: row.previous_status,
  status: row.status,
  currentAmount: Number(row.current_amount || 0),
  goalAmount: Number(row.goal_amount || 0),
  endDate: row.end_date,
  settledAt: row.updated_at,
});

const getKstToday = async (client = pool) => {
  const { rows } = await client.query(
    "SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date AS today"
  );

  return rows[0].today;
};

const isFundingSupportable = (funding, kstToday) => {
  if (!funding) {
    return false;
  }

  const status = String(funding.status || '').toUpperCase();

  if (!SETTLE_CANDIDATE_STATUSES.includes(status)) {
    return false;
  }

  if (!funding.end_date || !kstToday) {
    return true;
  }

  return String(funding.end_date).slice(0, 10) >= String(kstToday).slice(0, 10);
};

const createSettlementNotifications = async (settledFunding, client) => {
  try {
    if (settledFunding.status === 'SUCCESS') {
      await createFundingSuccessNotification(settledFunding.fundingId, { client });
      return;
    }

    if (settledFunding.status === 'FAILED') {
      await createFundingEndedNotification(settledFunding.fundingId, { client });
    }
  } catch (error) {
    console.warn('Failed to create funding settlement brewery notifications', {
      fundingId: settledFunding.fundingId,
      status: settledFunding.status,
      message: error.message,
    });
  }
};

const settleExpiredFundings = async () => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const kstToday = await getKstToday(client);
    const { rows } = await client.query(
      `
      WITH candidates AS (
        SELECT
          funding_id,
          title,
          status AS previous_status,
          current_amount,
          goal_amount,
          end_date
        FROM funding_projects
        WHERE status = ANY($1::text[])
          AND end_date IS NOT NULL
          AND end_date < $2::date
        FOR UPDATE
      ),
      updated AS (
        UPDATE funding_projects fp
        SET
          status = CASE
            WHEN COALESCE(c.current_amount, 0) >= COALESCE(c.goal_amount, 0) THEN 'SUCCESS'
            ELSE 'FAILED'
          END,
          updated_at = CURRENT_TIMESTAMP
        FROM candidates c
        WHERE fp.funding_id = c.funding_id
        RETURNING
          fp.funding_id,
          c.title,
          c.previous_status,
          fp.status,
          fp.current_amount,
          fp.goal_amount,
          fp.end_date,
          fp.updated_at
      )
      SELECT *
      FROM updated
      ORDER BY funding_id
      `,
      [SETTLE_CANDIDATE_STATUSES, kstToday]
    );

    const processedFundings = rows.map(mapSettledFunding);

    for (const funding of processedFundings) {
      await createSettlementNotifications(funding, client);
    }

    await client.query('COMMIT');

    return {
      successCount: processedFundings.filter((funding) => funding.status === 'SUCCESS').length,
      failedCount: processedFundings.filter((funding) => funding.status === 'FAILED').length,
      processedCount: processedFundings.length,
      processedFundings,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  SETTLE_CANDIDATE_STATUSES,
  getKstToday,
  isFundingSupportable,
  settleExpiredFundings,
};
