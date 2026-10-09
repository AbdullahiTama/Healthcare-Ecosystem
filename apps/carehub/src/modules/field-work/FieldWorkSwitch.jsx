import { useNavigate } from 'react-router-dom'
import { Radio, Compass } from 'lucide-react'
import { theme } from '../../styles/theme'

const { navy, tealDeep, tealMist, gray500, border } = theme

// The two Field Work capabilities, side by side, on both pages (spec §23).
// The wording is deliberate: Live Field Report is the OFFICIAL record managers
// see; Business Discovery is research and creates no record at all.
const OPTIONS = [
  { id: 'activity', title: 'LIVE FIELD REPORT', text: 'Report your current field activity to your manager.', Icon: Radio },
  { id: 'discovery', title: 'BUSINESS DISCOVERY', text: 'Find businesses and healthcare facilities around you or another location.', Icon: Compass },
]

/**
 * @param current  'activity' | 'discovery' — the page this is rendered on
 * @param allowed  module ids the signed-in role may open (from getNavItems)
 */
export default function FieldWorkSwitch({ current, allowed = [] }) {
  const navigate = useNavigate()
  const visible = OPTIONS.filter((o) => allowed.includes(o.id))
  if (visible.length < 2) return null // nothing to choose between
  return (
    <nav aria-label='Field work' style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginBottom: 16 }}>
      {visible.map(({ id, title, text, Icon }) => {
        const on = id === current
        return (
          <button key={id} onClick={() => !on && navigate('/dashboard/' + id)} aria-current={on ? 'page' : undefined}
            style={{ textAlign: 'left', display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 12, cursor: on ? 'default' : 'pointer',
              border: `1.5px solid ${on ? tealDeep : border}`, background: on ? tealMist : 'white' }}>
            <Icon size={18} color={on ? tealDeep : gray500} style={{ marginTop: 2, flexShrink: 0 }} aria-hidden='true' />
            <span>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 900, letterSpacing: 0.5, color: on ? tealDeep : navy }}>{title}</span>
              <span style={{ display: 'block', fontSize: 12.5, color: gray500, marginTop: 2 }}>{text}</span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}
