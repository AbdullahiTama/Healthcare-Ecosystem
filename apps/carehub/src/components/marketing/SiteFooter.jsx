import { Link } from 'react-router-dom'
import { theme } from '../../styles/theme'
import { Logo } from '../ui'

const { gray500, border } = theme

const linkStyle = { fontSize: 12, fontWeight: 600, color: gray500, textDecoration: 'none' }

// Footer for the CareHub landing. Each entry is { label, to }:
//   - `to` omitted        -> plain text, no link
//   - `#anchor` / mailto:  -> plain anchor
//   - anything else        -> router Link
//
// The plain-text case exists because the pre-rebuild footer rendered "CareFind"
// as <a href="#carefind">, an anchor pointing at a section that does not exist
// on the page. A dead link is worse than a label; entries without a real
// destination render as text until there is somewhere real to send people.
function Entry({ label, to }) {
  if (!to) return <span style={{ ...linkStyle, cursor: 'default' }}>{label}</span>
  if (to.startsWith('#') || to.startsWith('mailto:')) {
    return <a href={to} style={linkStyle}>{label}</a>
  }
  return <Link to={to} style={linkStyle}>{label}</Link>
}

export default function SiteFooter({ brandLine, links = [] }) {
  return (
    <footer style={{
      padding: '32px 24px', maxWidth: 1100, margin: '40px auto 0',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexWrap: 'wrap', gap: 12, borderTop: `1px solid ${border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: gray500 }}>
        <Logo size={18} />
        <span>{brandLine}</span>
      </div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {links.map((entry) => <Entry key={entry.label} {...entry} />)}
      </div>
    </footer>
  )
}
