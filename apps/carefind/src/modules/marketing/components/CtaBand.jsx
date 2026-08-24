import { Link } from 'react-router-dom'
import { theme } from '../../../styles/theme'
import { TYPE } from './tokens'

const { navy, navySoft, tealDeep } = theme

function Action({ action }) {
  const solid = action.variant !== 'ghost'
  return (
    <Link to={action.to} style={{
      padding: '16px 32px', borderRadius: 60, textDecoration: 'none',
      border: solid ? 'none' : '1px solid rgba(255,255,255,0.35)',
      background: solid ? '#fff' : 'rgba(255,255,255,0.08)',
      color: solid ? navy : '#fff', fontWeight: 800, fontSize: 15,
      display: 'inline-flex', alignItems: 'center', gap: 8,
    }}>
      {action.label}
    </Link>
  )
}

// Gradient call-to-action band closing every marketing page (spec section 5).
export default function CtaBand({ eyebrow, title, body, primary, secondary }) {
  return (
    <section data-reveal style={{ background: `linear-gradient(135deg, ${navy} 0%, ${navySoft} 55%, ${tealDeep} 100%)`, padding: '80px 24px', textAlign: 'center' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        {eyebrow && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderRadius: 40,
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
            fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.85)', marginBottom: 18,
          }}>
            {eyebrow}
          </div>
        )}
        <h2 style={{
          fontFamily: theme.fontDisplay, fontWeight: 900, fontSize: TYPE.displayL,
          letterSpacing: '-0.02em', color: '#fff', margin: '0 0 14px', lineHeight: 1.15,
        }}>
          {title}
        </h2>
        {body && <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.82)', lineHeight: 1.8, margin: '0 0 30px' }}>{body}</p>}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          {primary && <Action action={primary} />}
          {secondary && <Action action={secondary} />}
        </div>
      </div>
    </section>
  )
}
