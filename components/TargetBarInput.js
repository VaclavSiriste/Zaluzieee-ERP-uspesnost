export default function TargetBarInput({
  value,
  onChange,
  fillPct = 0,
  badge = 'Target',
  tone = 'target',
  inputRef
}) {
  const filled = Boolean(String(value || '').trim())
  return (
    <div
      className={[
        'targets-bar-track',
        `targets-bar-track-${tone}`,
        filled ? 'is-filled' : ''
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
          placeholder="Zadejte číslo"
          value={value}
          onChange={onChange}
        />
      </div>
    </div>
  )
}
