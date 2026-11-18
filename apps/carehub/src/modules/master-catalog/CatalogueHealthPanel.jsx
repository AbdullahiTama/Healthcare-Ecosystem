import { HeartPulse } from 'lucide-react'
import { theme } from '../../styles/theme'
import { HEALTH_ISSUES, scoreTone } from './catalogueRules'

const { navy, gray500, gray600, border, tealDeep, tealMist } = theme
const TONES = {
  good: { fg: theme.success, bg: theme.successBg },
  fair: { fg: theme.warning, bg: theme.warningBg },
  poor: { fg: theme.danger, bg: theme.dangerBg },
  neutral: { fg: gray600, bg: theme.gray100 },
}

// The catalogue's health (carehub_20270127): a 0-100 score and the count of each missing-data flag. Each count is a
// button: a flag with a list filter shows those items (pressed again, it clears); "Possible duplicates" opens the
// duplicates review. Flags at zero are left out. Shown only once the database has catalogue_health().
export default function CatalogueHealthPanel({ health, status = 'ready', active = '', onIssue, onDuplicates }) {
  if (!health?.available) return null
  const tone = scoreTone(health.score)
  const colours = TONES[tone.tone]
  const issues = HEALTH_ISSUES.filter((i) => Number(health.counts?.[i.key]) > 0)

  return (
    <section aria-labelledby='mc-health-title' aria-busy={status === 'loading'}
      style={{ marginBottom: '16px', padding: '14px 16px', borderRadius: theme.radius.lg, border: `1px solid ${border}`, background: 'white' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <HeartPulse size={18} aria-hidden='true' style={{ color: tealDeep }} />
        <h3 id='mc-health-title' style={{ margin: 0, fontSize: '14px', color: navy }}>Catalogue health</h3>
        <span role='status' aria-label={health.score == null ? 'No score yet' : `Score ${health.score} out of 100, ${tone.label}`}
          style={{ padding: '3px 10px', borderRadius: 999, fontSize: '12.5px', fontWeight: 800, color: colours.fg, background: colours.bg }}>
          {health.score == null ? tone.label : `${health.score}/100 · ${tone.label}`}
        </span>
        {status === 'error' && <span style={{ fontSize: '12px', color: theme.danger }}>Could not refresh the health check.</span>}
      </div>
      {health.total > 0 && (issues.length === 0
        ? <p style={{ margin: '10px 0 0', fontSize: '13px', color: gray600 }}>Nothing to fix: every item has its price, category, generic name and barcode.</p>
        : (
          <ul aria-label='Things to fix' style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {issues.map((i) => {
              const n = Number(health.counts[i.key])
              const pressed = active === i.key
              return (
                <li key={i.key}>
                  <button type='button' title={i.hint} aria-pressed={i.filter ? pressed : undefined}
                    onClick={() => (i.filter ? onIssue(pressed ? '' : i.key) : onDuplicates())}
                    style={{ display: 'flex', alignItems: 'baseline', gap: 6, minHeight: 36, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                      border: `1px solid ${pressed ? tealDeep : border}`, background: pressed ? tealMist : 'white', color: navy, fontSize: '12.5px' }}>
                    <strong style={{ fontSize: '14px' }}>{n.toLocaleString()}</strong>
                    <span>{i.label}{i.key === 'duplicates' ? (n === 1 ? ' (pair)' : ' (pairs)') : ''}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        ))}
      {active && <p style={{ margin: '8px 0 0', fontSize: '12px', color: gray500 }}>Showing only items with this flag. Press it again to show everything.</p>}
    </section>
  )
}
