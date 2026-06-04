import { formatDurationDays } from '@/lib/duration-metrics'

export default function DrilldownDays({ count, days, onOpen, title }) {
  const value = Number(count || 0)
  const text = formatDurationDays(days)

  if (value <= 0 || typeof onOpen !== 'function') {
    return <strong>{text}</strong>
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen()
    }
  }

  return (
    <span
      role="button"
      tabIndex={0}
      className="drilldown-trigger drilldown-days"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpen()
      }}
      onKeyDown={handleKeyDown}
      title={title || 'Kliknutím zobrazíte zakázky tvořící tento průměr'}
    >
      {text}
    </span>
  )
}
