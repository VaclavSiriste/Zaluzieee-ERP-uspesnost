import { useState, useMemo, useCallback } from 'react'

export function useMetricDrilldown(filters) {
  const [drilldown, setDrilldown] = useState(null)

  const stableFilters = useMemo(() => ({
    period: filters.period,
    dateBasis: filters.dateBasis,
    startDate: filters.startDate || '',
    endDate: filters.endDate || '',
    region: filters.region || ''
  }), [
    filters.period,
    filters.dateBasis,
    filters.startDate,
    filters.endDate,
    filters.region
  ])

  const closeDrilldown = useCallback(() => setDrilldown(null), [])

  const drilldownProps = useMemo(() => ({
    open: Boolean(drilldown),
    drilldown,
    filters: stableFilters,
    onClose: closeDrilldown
  }), [drilldown, stableFilters, closeDrilldown])

  return {
    openDrilldown: setDrilldown,
    closeDrilldown,
    drilldownProps
  }
}

export const DRILL = {
  leads: 'leads',
  scheduled: 'scheduled',
  completed: 'completed',
  cancelled: 'cancelled',
  waiting: 'waiting',
  missing: 'missing',
  inProgress: 'in_progress',
  decided: 'decided',
  category: 'category',
  durationLeadNavolani: 'duration_lead_navolani',
  durationNavolaniZamereni: 'duration_navolani_zamereni',
  durationLeadZamereni: 'duration_lead_zamereni'
}
