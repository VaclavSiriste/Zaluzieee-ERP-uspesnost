export default function TargetBarInput({
  value,
  onChange,
  fillPct = 0,
  badge = 'Target',
  tone = 'target',
  inputRef,
  readOnly = false
}) {
  const filled = Boolean(String(value || '').trim())
  return (
    <div
      className={[
        'targets-bar-track',
        `targets-bar-track-${tone}`,
        filled ? 'is-filled' : '',
        readOnly ? 'is-readonly' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ '--targets-fill': `${fillPct}%` }}
    >
      <div className="targets-bar-fill" aria-hidden="true" />
      <div className="targets-bar-inner">
        <span className="targets-bar-badge" aria-hidden="true">
          {badge}
        </span>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          className="targets-bar-input"
          placeholder={readOnly ? '—' : 'Zadejte číslo'}
          value={value}
          onChange={readOnly ? undefined : onChange}
          readOnly={readOnly}
          title={readOnly ? 'Počítáno automaticky z ERP podle data zaměření' : undefined}
        />
      </div>
    </div>
  )
}
