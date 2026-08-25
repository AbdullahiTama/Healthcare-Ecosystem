import { Link } from 'react-router-dom'
import { theme } from '../../styles/theme'
import { TYPE } from './tokens'

const { deepTeal, tealDeep } = theme

function Action({ action }) {
  const solid = action.variant !== 'ghost'
  return (
    <Link to={action.to} style={{
      padding: '15px 30px', borderRadius: theme.radius.md, textDecoration: 'none',
      border: solid ? 'none' : '1px solid rgba(255,255,255,0.3)',
      background: solid ? '#fff' : 'transparent',
      color: solid ? deepTeal : '#fff', fontWeight: solid ? 800 : 700, fontSize: 14,
      display: 'inline-flex', alignItems: 'center',
    }}>
      {action.label}
    </Link>
  )
}

// Gradient call-to-action band closing the marketing page (spec section 5).
export default function CtaBand({ eyebrow, title, body, primary, secondary }) {
  return (
    <section data-reveal style={{ background: `linear-gradient(135deg, ${deepTeal} 0%, ${tealDeep} 100%)`, padding: '72px 24px', textAlign: 'center', borderRadius: 20, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        {eyebrow && (
          <div style={{
            display: 'inline-flex', padding: '8px 16px', borderRadius: theme.radius.full,
            background: 'rgba(255,255,255,0.12)', color: '#fff',
            fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', marginBottom: 18,
          }}>
            {eyebrow}
          </div>
        )}
        <h2 style={{
          fontFamily: theme.fontDisplay, fontWeight: 700, fontSize: TYPE.displayL,
          color: '#fff', margin: '0 0 12px', lineHeight: 1.2,
        }}>
          {title}
        </h2>
        {body && <p style={{ color: 'rgba(255,255,255,0.75)', margin: '0 0 28px', fontSize: 14.5, lineHeight: 1.7 }}>{body}</p>}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          {primary && <Action action={primary} />}
          {secondary && <Action action={secondary} />}
        </div>
      </div>
    </section>
  )
}
