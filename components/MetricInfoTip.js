import { getOperationsMetricHelp } from '@/lib/operations-metric-help'

export default function MetricInfoTip({ helpId, text, label = 'Jak se počítá tato metrika' }) {
  const content = (text || getOperationsMetricHelp(helpId)).trim()
  if (!content) return null

  function stopBubble(event) {
    event.stopPropagation()
  }

  return (
    <span className="metric-info-tip" onClick={stopBubble} onMouseDown={stopBubble}>
      <span
        className="metric-info-tip-trigger"
        role="img"
        aria-label={label}
        aria-describedby={helpId ? `metric-help-${helpId}` : undefined}
        tabIndex={0}
      >
        !
      </span>
      <span
        className="metric-info-tip-popup"
        role="tooltip"
        id={helpId ? `metric-help-${helpId}` : undefined}
      >
        {content}
      </span>
    </span>
  )
}

export function MetricLabel({ children, helpId, text, className = 'sla-kpi-label' }) {
  return (
    <span className="metric-label-with-tip">
      <span className={className}>{children}</span>
      <MetricInfoTip helpId={helpId} text={text} />
    </span>
  )
}
