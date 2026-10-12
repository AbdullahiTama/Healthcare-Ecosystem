import './admin.css'

// One bordered panel divided by hairlines into metric cells, in place of a row
// of separate cards. A cell whose data failed to load says so and offers a
// retry in the number's place: it never shows 0.
//
// item: { key, label, value, hint, status: 'ok' | 'error' | 'loading', onRetry, onOpen }
export default function MetricStrip({ items, label = 'Platform totals' }) {
  return (
    <dl className="adm-panel adm-strip" aria-label={label}>
      {items.map(item => (
        <div className="adm-cell" key={item.key}>
          <dt>
            {item.onOpen
              ? <button type="button" className="adm-btn-reset adm-cell-link" onClick={item.onOpen}>{item.label}</button>
              : item.label}
          </dt>
          <dd className="adm-num">
            {item.status === 'loading' && <span className="adm-skel" role="status" aria-label={`Loading ${item.label}`} />}
            {item.status === 'error' && (
              <span className="adm-cell-error">
                Couldn't load · <button type="button" className="adm-btn-reset adm-retry" onClick={item.onRetry}>Retry</button>
              </span>
            )}
            {(item.status === 'ok' || item.status === undefined) && item.value}
          </dd>
          {item.hint && item.status !== 'error' && item.status !== 'loading' && <p>{item.hint}</p>}
        </div>
      ))}
    </dl>
  )
}
