export default function DrilldownMoney({ count, amount, onOpen, title }) {
  const value = Number(count || 0)
  const text = String(amount ?? '')

  if (value <= 0 || typeof onOpen !== 'function') {
    return <strong>{text || '0 Kč'}</strong>
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
      className="drilldown-trigger drilldown-money"
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
