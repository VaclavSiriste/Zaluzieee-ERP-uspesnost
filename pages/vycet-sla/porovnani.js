import { useState } from 'react'
import AppMenu from '@/components/AppMenu'
import FilterAssistant from '@/components/FilterAssistant'
import SlaComparePanel from '@/components/SlaComparePanel'

export default function VycetSlaPorovnaniPage() {
  const [period, setPeriod] = useState('month')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [expanded, setExpanded] = useState(true)

  function handlePeriodChange(nextPeriod) {
    setPeriod(nextPeriod)
    if (nextPeriod !== 'custom') {
      setStartDate('')
      setEndDate('')
    }
  }

  return (
    <main className="dashboard-container sla-page">
      <div className="dashboard-layout">
        <AppMenu active="slaCompare" />
        <div className="dashboard-main">
          <header className="sla-hero">
            <div className="sla-hero-copy">
              <p className="sla-kicker">Operátoři · SLA reporting</p>
              <h1>SLA – porovnání metod</h1>
              <p className="sla-hero-lead">
                Všechny CZ organizace. Na Řízení provozu (zaluzieee - CZ) je stejný blok jen pro
                organization_id 5.
              </p>
            </div>
            <div className="sla-hero-glow" aria-hidden="true" />
          </header>

          <FilterAssistant
            period={period}
            onPeriodChange={handlePeriodChange}
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={(value) => {
              setStartDate(value)
              setPeriod('custom')
            }}
            onEndDateChange={(value) => {
              setEndDate(value)
              setPeriod('custom')
            }}
            hideDateBasis
          />

          <SlaComparePanel
            period={period}
            startDate={startDate}
            endDate={endDate}
            expanded={expanded}
            onToggle={() => setExpanded((open) => !open)}
          />
        </div>
      </div>
    </main>
  )
}
