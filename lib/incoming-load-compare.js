/**
 * Nápor na příchozí linku + odmítnuté hovory — srovnání MTD vs stejné dny minulého měsíce.
 */

import { formatDateInput } from '@/lib/metrics-query'
import {
  buildSlaQueueFilterSql,
  INCOMING_CALLS_FROM,
  queryDaktelaWithRetry
} from '@/lib/incoming-line-sla'
import {
  REJECTED_BY_CUSTOMER_SQL,
  REJECTED_BY_OPERATOR_SQL
} from '@/lib/rejected-call-sql'

/** Kalendářní rozsahy: tento měsíc 1→dnes a minulý měsíc 1→stejný den (clamp). */
export function buildMonthToDateCompareRanges(now = new Date()) {
  const year = now.getFullYear()
  const month = now.getMonth()
  const day = now.getDate()

  const thisStart = new Date(year, month, 1)
  const thisEnd = new Date(year, month, day)

  const lastMonthLastDay = new Date(year, month, 0).getDate()
  const lastEndDay = Math.min(day, lastMonthLastDay)
  const lastStart = new Date(year, month - 1, 1)
  const lastEnd = new Date(year, month - 1, lastEndDay)

  return {
    asOfDate: formatDateInput(thisEnd),
    thisMonth: {
      startDate: formatDateInput(thisStart),
      endDate: formatDateInput(thisEnd),
      label: thisStart.toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' })
    },
    lastMonth: {
      startDate: formatDateInput(lastStart),
      endDate: formatDateInput(lastEnd),
      label: lastStart.toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' })
    }
  }
}

function buildLoadCompareSql(brandId) {
  const queueFilter = buildSlaQueueFilterSql(brandId)
  return `
    SELECT
      COUNT(*)::int AS incoming_calls,
      COUNT(*) FILTER (WHERE COALESCE(c.answered, false) IS NOT TRUE)::int AS rejected_calls,
      COUNT(*) FILTER (WHERE (${REJECTED_BY_OPERATOR_SQL}))::int AS rejected_by_operator,
      COUNT(*) FILTER (WHERE (${REJECTED_BY_CUSTOMER_SQL}))::int AS rejected_by_customer
    ${INCOMING_CALLS_FROM}
    WHERE (c.call_time)::date >= $1::date
      AND (c.call_time)::date <= $2::date
      AND UPPER(COALESCE(c.direction, '')) = 'IN'
      ${queueFilter}
  `
}

function normalizeBucket(row) {
  return {
    incoming_calls: Number(row?.incoming_calls) || 0,
    rejected_calls: Number(row?.rejected_calls) || 0,
    rejected_by_operator: Number(row?.rejected_by_operator) || 0,
    rejected_by_customer: Number(row?.rejected_by_customer) || 0
  }
}

function deltaPct(current, previous) {
  const cur = Number(current) || 0
  const prev = Number(previous) || 0
  if (prev <= 0) return cur > 0 ? 100 : 0
  return Math.round(((cur - prev) / prev) * 1000) / 10
}

export async function fetchIncomingLoadCompare({ brandId = 'cz', now = new Date() } = {}) {
  const ranges = buildMonthToDateCompareRanges(now)
  const sql = buildLoadCompareSql(brandId)

  const [thisResult, lastResult] = await Promise.all([
    queryDaktelaWithRetry(sql, [ranges.thisMonth.startDate, ranges.thisMonth.endDate]),
    queryDaktelaWithRetry(sql, [ranges.lastMonth.startDate, ranges.lastMonth.endDate])
  ])

  const thisMonth = normalizeBucket(thisResult.rows[0])
  const lastMonth = normalizeBucket(lastResult.rows[0])

  return {
    asOfDate: ranges.asOfDate,
    thisMonth: {
      ...ranges.thisMonth,
      ...thisMonth
    },
    lastMonth: {
      ...ranges.lastMonth,
      ...lastMonth
    },
    delta: {
      incoming_calls_pct: deltaPct(thisMonth.incoming_calls, lastMonth.incoming_calls),
      rejected_calls_pct: deltaPct(thisMonth.rejected_calls, lastMonth.rejected_calls),
      rejected_by_operator_pct: deltaPct(
        thisMonth.rejected_by_operator,
        lastMonth.rejected_by_operator
      ),
      rejected_by_customer_pct: deltaPct(
        thisMonth.rejected_by_customer,
        lastMonth.rejected_by_customer
      )
    }
  }
}
