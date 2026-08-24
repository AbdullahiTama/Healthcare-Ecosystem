import { Link } from 'react-router-dom'
import { theme } from '../../../styles/theme'
import Logo from '../../social-feed/Logo.jsx'

// Footer for marketing pages. `#...` link targets render as plain anchors.
export default function SiteFooter({ brandLine, links = [] }) {
  return (
    <footer style={{
      padding: '32px 24px', maxWidth: 1100, margin: '0 auto',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexWrap: 'wrap', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: theme.textLight }}>
        <Logo size={18} tone="dark" markOnly />
        <span>{brandLine}</span>
      </div>
      <div style={{ display: 'flex', gap: 20 }}>
        {links.map(({ label, to }) => (
          to.startsWith('#') ? (
            <a key={label} href={to} style={{ fontSize: 13, fontWeight: 600, color: theme.textMid, textDecoration: 'none' }}>{label}</a>
          ) : (
            <Link key={label} to={to} style={{ fontSize: 13, fontWeight: 600, color: theme.textMid, textDecoration: 'none' }}>{label}</Link>
          )
        ))}
      </div>
    </footer>
  )
}
