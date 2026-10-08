import { Link } from 'react-router-dom'
import { theme } from '../../../styles/theme'
import { Logo } from '../../../components/ui'
import { FOOTER_GROUPS, SUPPORT_EMAIL, CAREFIND_URL } from '../data/navigation'

function FooterLink({ link }) {
  const style = {
    display: 'inline-block',
    padding: '4px 0',
    fontSize: 13,
    fontWeight: 500,
    lineHeight: 1.5,
    color: theme.gray600,
    textDecoration: 'none',
  }

  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" style={style}>
        {link.label}
      </a>
    )
  }

  // Internal routes go through the router; section anchors stay plain anchors
  // so the browser does the scroll without remounting the page.
  if (link.href.startsWith('/')) {
    return (
      <Link to={link.href} style={style}>
        {link.label}
      </Link>
    )
  }

  return (
    <a href={link.href} style={style}>
      {link.label}
    </a>
  )
}

export function SiteFooter() {
  const year = new Date().getFullYear()

  return (
    <footer
      style={{
        background: '#ffffff',
        borderTop: `1px solid ${theme.border}`,
        padding: 'clamp(48px, 6vw, 72px) 24px 32px',
      }}
    >
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))',
            gap: 32,
            marginBottom: 48,
          }}
        >
          <div style={{ gridColumn: 'span 1', minWidth: 0 }}>
            <Link
              to="/"
              aria-label="CareHub home"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 9,
                textDecoration: 'none',
                marginBottom: 14,
              }}
            >
              <Logo size={28} />
              <span style={{ fontWeight: 900, fontSize: 16, color: theme.navy }}>CareHub</span>
            </Link>
            <p
              style={{
                fontSize: 13,
                fontWeight: 500,
                lineHeight: 1.6,
                color: theme.gray600,
                margin: '0 0 16px',
                maxWidth: 260,
              }}
            >
              The operating platform for healthcare businesses in Nigeria.
            </p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              style={{ fontSize: 13, fontWeight: 600, color: theme.tealDeep, textDecoration: 'none' }}
            >
              {SUPPORT_EMAIL}
            </a>
          </div>

          {FOOTER_GROUPS.map((group) => (
            <div key={group.title} style={{ minWidth: 0 }}>
              <h2
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: theme.navy,
                  margin: '0 0 14px',
                }}
              >
                {group.title}
              </h2>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
                {group.links?.map((link) => (
                  <li key={link.label}>
                    <FooterLink link={link} />
                  </li>
                ))}
                {group.soon?.map((label) => (
                  <li
                    key={label}
                    style={{
                      display: 'inline-block',
                      padding: '4px 0',
                      fontSize: 13,
                      fontWeight: 500,
                      color: theme.gray600,
                    }}
                  >
                    {label}
                    <span
                      style={{
                        marginLeft: 7,
                        fontSize: 9.5,
                        fontWeight: 800,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: theme.gray600,
                        background: theme.gray100,
                        border: `1px solid ${theme.border}`,
                        borderRadius: theme.radius.full,
                        padding: '2px 7px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Soon
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div
          style={{
            borderTop: `1px solid ${theme.border}`,
            paddingTop: 24,
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px 24px',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <p style={{ fontSize: 12.5, fontWeight: 500, color: theme.gray600, margin: 0 }}>
            &copy; {year} CareHub. All rights reserved.
          </p>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <a
              href={CAREFIND_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12.5, fontWeight: 600, color: theme.gray600, textDecoration: 'none' }}
            >
              CareFind
            </a>
            <Link
              to="/apply-agent"
              style={{ fontSize: 12.5, fontWeight: 600, color: theme.gray600, textDecoration: 'none' }}
            >
              Agent programme
            </Link>
            <Link
              to="/login"
              style={{ fontSize: 12.5, fontWeight: 600, color: theme.gray600, textDecoration: 'none' }}
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
