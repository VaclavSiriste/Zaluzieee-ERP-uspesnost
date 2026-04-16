import { getPool } from '@/lib/db-esm'

export default async function handler(req, res) {
  const { period = 'month', startDate, endDate } = req.query
  const dateBasis = resolveDateBasis(req.query.dateBasis)

  try {
    const pool = getPool()
    if (!pool) {
      throw new Error('Databázové připojení není dostupné')
    }

    const { start, end } = resolveDateRange({ period, startDate, endDate })
    const { dateFilterCte, dateFilterJoin, dateFilterWhere } = getDateFilterSql(dateBasis)

    const result = await pool.query(
      `
      WITH ${dateFilterCte ? `${dateFilterCte},` : ''}
      dopadlo_hodnota AS (
        SELECT DISTINCT ON (ocv.order_id)
          ocv.order_id,
          LOWER(TRIM(ocv.value)) AS dopadlo_value
        FROM orders_column_values ocv
        JOIN orders_columns oc ON oc.id = ocv.column_id
        WHERE oc.slug = 'dopadlo_zamereni'
        ORDER BY ocv.order_id, ocv.id DESC
      ),
      reason_value AS (
        SELECT DISTINCT ON (ocv.order_id)
          ocv.order_id,
          LOWER(TRIM(ocv.value)) AS reason_slug
        FROM orders_column_values ocv
        JOIN orders_columns oc ON oc.id = ocv.column_id
        WHERE oc.slug = 'proc_nedopadlo_zamereni'
        ORDER BY ocv.order_id, ocv.id DESC
      ),
      zamerovac_assign AS (
        SELECT DISTINCT ON (order_id)
          order_id,
          user_id
        FROM order_user_assignments
        WHERE assignment_type = 'zamerovac'
        ORDER BY order_id, id DESC
      ),
      domluvil_assign AS (
        SELECT DISTINCT ON (order_id)
          order_id,
          user_id
        FROM order_user_assignments
        WHERE assignment_type = 'domluvil_zamereni'
        ORDER BY order_id, id DESC
      )
      SELECT
        COALESCE(NULLIF(zu.name, ''), 'Nepřiřazený technik') AS technician_name,
        COALESCE(NULLIF(rv.reason_slug, ''), 'bez_duvodu') AS reason_slug,
        COALESCE(NULLIF(du.name, ''), 'Nepřiřazený domlouvač') AS scheduler_name,
        COUNT(DISTINCT o.id) AS cnt
      FROM orders o
      ${dateFilterJoin}
      JOIN dopadlo_hodnota dh ON dh.order_id = o.id
      LEFT JOIN reason_value rv ON rv.order_id = o.id
      LEFT JOIN zamerovac_assign za ON za.order_id = o.id
      LEFT JOIN users zu ON zu.id = za.user_id
      LEFT JOIN domluvil_assign da ON da.order_id = o.id
      LEFT JOIN users du ON du.id = da.user_id
      WHERE ${dateFilterWhere}
        AND dh.dopadlo_value = 'ne'
      GROUP BY
        COALESCE(NULLIF(zu.name, ''), 'Nepřiřazený technik'),
        COALESCE(NULLIF(rv.reason_slug, ''), 'bez_duvodu'),
        COALESCE(NULLIF(du.name, ''), 'Nepřiřazený domlouvač')
      ORDER BY technician_name, cnt DESC
      `,
      [start, end]
    )

    const byTechnician = new Map()

    for (const row of result.rows) {
      const techName = row.technician_name
      const reasonSlug = row.reason_slug
      const schedulerName = row.scheduler_name
      const count = Number(row.cnt || 0)

      if (!byTechnician.has(techName)) {
        byTechnician.set(techName, {
          technician_name: techName,
          total_failed: 0,
          reasons: new Map(),
          schedulers: new Map()
        })
      }

      const bucket = byTechnician.get(techName)
      bucket.total_failed += count

      const reasonCurrent = bucket.reasons.get(reasonSlug) || {
        reason_slug: reasonSlug,
        reason_label: toReasonLabel(reasonSlug),
        count: 0,
        schedulers: new Map()
      }
      reasonCurrent.count += count
      const reasonSchedulerCurrent = reasonCurrent.schedulers.get(schedulerName) || {
        scheduler_name: schedulerName,
        count: 0
      }
      reasonSchedulerCurrent.count += count
      reasonCurrent.schedulers.set(schedulerName, reasonSchedulerCurrent)
      bucket.reasons.set(reasonSlug, reasonCurrent)

      const schedulerCurrent = bucket.schedulers.get(schedulerName) || {
        scheduler_name: schedulerName,
        count: 0
      }
      schedulerCurrent.count += count
      bucket.schedulers.set(schedulerName, schedulerCurrent)
    }

    const bubbles = Array.from(byTechnician.values())
      .map((item) => ({
        ...item,
        reasons: Array.from(item.reasons.values())
          .map((reason) => ({
            ...reason,
            schedulers: Array.from(reason.schedulers.values())
              .map((scheduler) => ({
                ...scheduler,
                share_pct_reason: reason.count > 0
                  ? ((scheduler.count / reason.count) * 100).toFixed(2)
                  : '0.00'
              }))
              .sort((a, b) => b.count - a.count),
            share_pct: item.total_failed > 0
              ? ((reason.count / item.total_failed) * 100).toFixed(2)
              : '0.00'
          }))
          .sort((a, b) => b.count - a.count),
        schedulers: Array.from(item.schedulers.values())
          .map((scheduler) => ({
            ...scheduler,
            share_pct: item.total_failed > 0
              ? ((scheduler.count / item.total_failed) * 100).toFixed(2)
              : '0.00'
          }))
          .sort((a, b) => b.count - a.count)
      }))
      .sort((a, b) => b.total_failed - a.total_failed)

    return res.status(200).json({
      period,
      dateBasis,
      dateRange: { start: start.toISOString(), end: end.toISOString() },
      bubbles,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    })
  }
}

function toReasonLabel(value) {
  if (!value || value === 'bez_duvodu') return 'Bez důvodu'

  const knownLabels = {
    'odlozeno': 'Odloženo',
    'zruseno': 'Zrušeno',
    'nezastizen': 'Nezastižen',
    'vysoka-cena': 'Vysoká cena',
    'cenova-nabidka': 'Cenová nabídka',
    'nema-zajem': 'Nemá zájem',
    'nemozna-realizace': 'Nemožná realizace',
    'cn-predem': 'CN předem',
    'nekomunikuje': 'Nekomunikuje',
    'rozmysli-se': 'Rozmyslí se',
    'nedostatek-financi': 'Nedostatek financí',
    'znovuzamereni': 'Znovuzaměření'
  }

  if (knownLabels[value]) return knownLabels[value]

  const text = value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function resolveDateRange({ period, startDate, endDate }) {
  const now = new Date()
  const end = endDate ? new Date(endDate) : now
  let start = startDate ? new Date(startDate) : now

  if (!startDate) {
    if (period === 'week') start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    else if (period === 'ytd') start = new Date(now.getFullYear(), 0, 1)
    else start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Neplatné datum v parametrech')
  }

  return { start, end }
}

function resolveDateBasis(value) {
  if (value === 'created' || value === 'navolani' || value === 'zamereni') return value
  return 'navolani'
}

function getDateFilterSql(dateBasis) {
  if (dateBasis === 'created') {
    return {
      dateFilterCte: '',
      dateFilterJoin: '',
      dateFilterWhere: 'o.created_at::date >= $1::date AND o.created_at::date <= $2::date'
    }
  }

  const slug = dateBasis === 'zamereni' ? 'datum_zamereni' : 'datum_navolani'
  const withPlaceholderCleanup = dateBasis === 'navolani'
    ? `
      AND NULLIF(ocv_latest.raw_value, '') IS NOT NULL
      AND LOWER(ocv_latest.raw_value) NOT IN ('nezadano', 'nezadáno', 'n/a', 'null', '-')
    `
    : `
      AND NULLIF(ocv_latest.raw_value, '') IS NOT NULL
    `

  return {
    dateFilterCte: `
      datum_filter AS (
        SELECT
          ocv_latest.order_id,
          ocv_latest.filter_date
        FROM (
          SELECT DISTINCT ON (ocv.order_id)
            ocv.order_id,
            TRIM(ocv.value) AS raw_value,
            CASE
              WHEN TRIM(ocv.value) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN SUBSTRING(TRIM(ocv.value), 1, 10)::date
              ELSE NULL
            END AS filter_date
          FROM orders_column_values ocv
          JOIN orders_columns oc ON oc.id = ocv.column_id
          WHERE oc.slug = '${slug}'
          ORDER BY ocv.order_id, ocv.id DESC
        ) ocv_latest
        WHERE ocv_latest.filter_date IS NOT NULL
        ${withPlaceholderCleanup}
      )
    `,
    dateFilterJoin: 'JOIN datum_filter df ON df.order_id = o.id',
    dateFilterWhere: 'df.filter_date >= $1::date AND df.filter_date <= $2::date'
  }
}
