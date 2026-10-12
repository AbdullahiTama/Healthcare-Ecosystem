import './admin.css'

// A stacked bar showing how one set of records divides by status. The bar is
// decoration; the same numbers are in the legend text and the accessible name.
// segments: [{ label, value, tone: 'urgent' | 'ok' | 'muted' }]
export default function SplitBar({ title, segments }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  const summary = segments.map(s => `${s.value} ${s.label.toLowerCase()}`).join(', ')
  return (
    <div className="adm-st">
      <header><strong>{title}</strong><span className="adm-num">{total} total</span></header>
      {total === 0 ? (
        <p className="adm-note">None yet</p>
      ) : (
        <>
          <div className="adm-bar" role="img" aria-label={`${title}: ${summary}`}>
            {segments.filter(s => s.value > 0).map(s => (
              <i key={s.label} className={`adm-tone-${s.tone || 'muted'}`} style={{ width: `${(s.value / total) * 100}%` }} />
            ))}
          </div>
          <div className="adm-legend adm-num">
            {segments.map(s => <span key={s.label} className={`adm-tone-${s.tone || 'muted'}`}>{s.label} {s.value}</span>)}
          </div>
        </>
      )}
    </div>
  )
}
