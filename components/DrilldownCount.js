export default function DrilldownCount(props) {
  const {
    count,
    onOpen,
    className = '',
    title,
    text
  } = props

  const value = Number(count || 0)

  let displayText
  if (text != null && text !== '') {
    displayText = text
  } else if (props.children != null && props.children !== '') {
    displayText = props.children
  } else if (typeof count === 'string' && count !== '') {
    displayText = count
  } else {
    displayText = value.toLocaleString('cs-CZ')
  }

  const isClickable = value > 0 && typeof onOpen === 'function'

  if (!isClickable) {
    return <strong>{displayText}</strong>
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
      className={`drilldown-trigger ${className}`.trim()}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpen()
      }}
      onKeyDown={handleKeyDown}
      title={title || 'Kliknutím zobrazíte seznam zakázek'}
    >
      {displayText}
    </span>
  )
}
