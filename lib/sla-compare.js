/**
 * Porovnání SLA 24/48/72: stará metoda vs. nová pole ze zadání SLA reportingu.
 *
 * Stará: orders.first_iframe_change_at − created_at (dnešní Výčet SLA).
 * Nová:  orders.first_response_minutes, případně first_contact_at − created_at
 *        (+ first_contact_type: incoming / outgoing / missed).
 *
 * Nové sloupce nemusí v DWH existovat (větev callcenter-sla) → zjišťujeme je
 * z information_schema a místo pádu vracíme, co chybí.
 */

import {
  CALENDAR_DATE_SQL,
  SLA_POPTAVKY_FROM_SQL,
  appendOrganizationFilter,
  buildSlaPoptavkyFiltersSql
} from '@/lib/sla-metrics'

export const NEW_SLA_COLUMNS = ['first_contact_at', 'first_contact_type', 'first_response_minutes']

export const SLA_HOURS = [24, 48, 72]

export async function detectNewSlaColumns(pool) {
  const { rows } = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'orders'
      AND table_schema = current_schema()
      AND column_name = ANY($1::text[])
    `,
    [NEW_SLA_COLUMNS]
  )
  const present = new Set(rows.map((row) => row.column_name))
  return Object.fromEntries(NEW_SLA_COLUMNS.map((name) => [name, present.has(name)]))
}

/** Hodiny do prvního kontaktu podle nové metody (minuty mají přednost před razítkem). */
function newHoursSql(columns) {
  const parts = []
  if (columns.first_response_minutes) parts.push('o.first_response_minutes / 60.0')
  if (columns.first_contact_at) {
    parts.push('EXTRACT(EPOCH FROM (o.first_contact_at - o.created_at)) / 3600.0')
  }
  return parts.length ? `COALESCE(${parts.join(', ')})` : 'NULL::numeric'
}

/**
 * Společná množina = stejné poptávky jako SLA 24/48/72 ve Výčtu SLA
 * (kalendářní den, bez duplikací/reklamací, s ID formuláře, Důvod ne ≠ Venkovky).
 * onlyCovered: jen objednávky vzniklé od prvního vyplněného first_contact_at —
 * starší objednávky nová pole nemají a srovnání by zkreslily.
 */
function buildBaseCte(columns, { start, end, organizationId, onlyCovered }) {
  const base = appendOrganizationFilter([start, end], organizationId)
  const coveredSql =
    onlyCovered && columns.first_contact_at
      ? `AND o.created_at >= (SELECT MIN(created_at) FROM orders WHERE first_contact_at IS NOT NULL)`
      : ''
  const typeSql = columns.first_contact_type ? 'o.first_contact_type' : 'NULL::text'
  const newAtSql = columns.first_contact_at ? 'o.first_contact_at' : 'NULL::timestamp'

  return {
    params: base.params,
    sql: `
      base AS (
        SELECT
          o.id AS order_id,
          o.created_at,
          o.status,
          o.first_iframe_change_at AS old_at,
          ${newAtSql} AS new_at,
          ${typeSql} AS new_type,
          EXTRACT(EPOCH FROM (o.first_iframe_change_at - o.created_at)) / 3600.0 AS old_h,
          ${newHoursSql(columns)} AS new_h
        ${SLA_POPTAVKY_FROM_SQL}
        WHERE (${CALENDAR_DATE_SQL}) >= $1::date
          AND (${CALENDAR_DATE_SQL}) <= $2::date
          ${buildSlaPoptavkyFiltersSql()}
          ${base.sql}
          ${coveredSql}
      )
    `
  }
}

function slaAggregatesSql() {
  return SLA_HOURS.map(
    (h) => `
      COUNT(*) FILTER (WHERE old_h <= ${h})::int AS old_sla${h},
      COUNT(*) FILTER (WHERE new_h <= ${h})::int AS new_sla${h},
      COUNT(*) FILTER (WHERE old_h <= ${h} AND new_h <= ${h})::int AS both_sla${h},
      COUNT(*) FILTER (WHERE old_h <= ${h} AND (new_h IS NULL OR new_h > ${h}))::int AS only_old_sla${h},
      COUNT(*) FILTER (WHERE new_h <= ${h} AND (old_h IS NULL OR old_h > ${h}))::int AS only_new_sla${h},
      COUNT(*) FILTER (WHERE old_h <= ${h} AND new_h IS NULL)::int AS only_old_missing_sla${h},
      COUNT(*) FILTER (WHERE old_h <= ${h} AND new_h > ${h})::int AS only_old_late_sla${h}
    `
  ).join(',')
}

export async function fetchSlaComparison(pool, { start, end, organizationId, onlyCovered = true }) {
  const columns = await detectNewSlaColumns(pool)
  const hasNew = columns.first_contact_at || columns.first_response_minutes
  const cte = buildBaseCte(columns, { start, end, organizationId, onlyCovered })

  const summaryPromise = pool.query(
    `
    WITH ${cte.sql}
    SELECT
      COUNT(*)::int AS total,
      COUNT(old_h)::int AS old_filled,
      COUNT(new_h)::int AS new_filled,
      COUNT(*) FILTER (WHERE old_h < 0)::int AS old_negative,
      COUNT(*) FILTER (WHERE new_h < 0)::int AS new_negative,
      MIN(created_at) AS first_created,
      MIN(created_at) FILTER (WHERE new_h IS NOT NULL) AS first_new_filled,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY old_h) AS old_median_h,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY new_h) AS new_median_h,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY new_h - old_h) AS median_diff_h,
      ${slaAggregatesSql()}
    FROM base
    `,
    cte.params
  )

  const byTypePromise = columns.first_contact_type
    ? pool.query(
        `
        WITH ${cte.sql}
        SELECT
          COALESCE(new_type, '(prázdné)') AS type,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE new_h <= 24)::int AS new_sla24,
          COUNT(*) FILTER (WHERE old_h <= 24)::int AS old_sla24,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY new_h) AS new_median_h
        FROM base
        GROUP BY 1
        ORDER BY total DESC
        `,
        cte.params
      )
    : Promise.resolve({ rows: [] })

  const diffPromise = hasNew
    ? pool.query(
        `
        WITH ${cte.sql}
        SELECT order_id, created_at, status, old_at, new_at, new_type, old_h, new_h
        FROM base
        WHERE (old_h <= 24) IS DISTINCT FROM (new_h <= 24)
        ORDER BY ABS(COALESCE(new_h, 0) - COALESCE(old_h, 0)) DESC, created_at DESC
        LIMIT 200
        `,
        cte.params
      )
    : Promise.resolve({ rows: [] })

  const [summary, byType, diff] = await Promise.all([summaryPromise, byTypePromise, diffPromise])
  const row = summary.rows[0] || {}
  const num = (value) => (value == null ? null : Number(value))

  return {
    columns,
    hasNew: Boolean(hasNew),
    onlyCovered: Boolean(onlyCovered && columns.first_contact_at),
    summary: {
      total: num(row.total) || 0,
      old_filled: num(row.old_filled) || 0,
      new_filled: num(row.new_filled) || 0,
      old_negative: num(row.old_negative) || 0,
      new_negative: num(row.new_negative) || 0,
      first_created: row.first_created || null,
      first_new_filled: row.first_new_filled || null,
      old_median_h: num(row.old_median_h),
      new_median_h: num(row.new_median_h),
      median_diff_h: num(row.median_diff_h),
      sla: SLA_HOURS.map((h) => ({
        hours: h,
        old: num(row[`old_sla${h}`]) || 0,
        new: num(row[`new_sla${h}`]) || 0,
        both: num(row[`both_sla${h}`]) || 0,
        only_old: num(row[`only_old_sla${h}`]) || 0,
        only_new: num(row[`only_new_sla${h}`]) || 0,
        only_old_missing: num(row[`only_old_missing_sla${h}`]) || 0,
        only_old_late: num(row[`only_old_late_sla${h}`]) || 0
      }))
    },
    byType: byType.rows.map((r) => ({
      type: r.type,
      total: num(r.total) || 0,
      new_sla24: num(r.new_sla24) || 0,
      old_sla24: num(r.old_sla24) || 0,
      new_median_h: num(r.new_median_h)
    })),
    disagreements: diff.rows.map((r) => ({
      order_id: r.order_id,
      created_at: r.created_at,
      status: r.status,
      old_at: r.old_at,
      new_at: r.new_at,
      new_type: r.new_type,
      old_h: num(r.old_h),
      new_h: num(r.new_h)
    }))
  }
}
