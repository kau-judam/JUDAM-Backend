const pool = require('../config/db');

const ACTIVE_FUNDING_STATUSES = ['ACTIVE', 'ONGOING'];
const SUCCESS_FUNDING_STATUSES = ['SUCCESS', 'SUCCESSFUL', 'FUNDING_SUCCESS'];
const KST_CURRENT_DATE_SQL = "(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date";

const toNumber = (value) => Number(value || 0);

const getPublicStatsSummary = async () => {
  const { rows } = await pool.query(
    `
      WITH funding_stats AS (
        SELECT
          COUNT(*) FILTER (
            WHERE UPPER(COALESCE(status, '')) = ANY($1::text[])
              AND (start_date IS NULL OR start_date <= ${KST_CURRENT_DATE_SQL})
              AND (end_date IS NULL OR end_date >= ${KST_CURRENT_DATE_SQL})
          )::int AS active_funding_count,
          COUNT(*) FILTER (
            WHERE UPPER(COALESCE(status, '')) = ANY($2::text[])
          )::int AS successful_funding_count,
          COALESCE(SUM(COALESCE(current_amount, 0)), 0)::bigint AS total_funding_amount,
          COALESCE(SUM(COALESCE(supporter_count, 0)), 0)::bigint AS total_backer_count
        FROM funding_projects
      ),
      member_stats AS (
        SELECT COUNT(*)::int AS member_count
        FROM users
        WHERE deleted_at IS NULL
      )
      SELECT
        member_stats.member_count,
        funding_stats.active_funding_count,
        funding_stats.successful_funding_count,
        funding_stats.total_funding_amount,
        funding_stats.total_backer_count
      FROM funding_stats
      CROSS JOIN member_stats
    `,
    [ACTIVE_FUNDING_STATUSES, SUCCESS_FUNDING_STATUSES],
  );

  const stats = rows[0] || {};
  const activeFundingCount = toNumber(stats.active_funding_count);
  const successfulFundingCount = toNumber(stats.successful_funding_count);
  const totalFundingAmount = toNumber(stats.total_funding_amount);
  const totalBackerCount = toNumber(stats.total_backer_count);

  return {
    home: {
      memberCount: toNumber(stats.member_count),
      totalFundingAmount,
      activeFundingCount,
      successfulFundingCount,
    },
    funding: {
      supportableFundingCount: activeFundingCount,
      totalBackerCount,
      successfulProjectCount: successfulFundingCount,
      totalRaisedAmount: totalFundingAmount,
    },
  };
};

module.exports = {
  getPublicStatsSummary,
};
