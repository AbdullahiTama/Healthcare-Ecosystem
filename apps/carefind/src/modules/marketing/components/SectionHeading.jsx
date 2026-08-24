import { theme } from '../../../styles/theme'

const { tealDeep, textDark, textMid } = theme

// Eyebrow + title + intro block used above every marketing section.
export default function SectionHeading({ eyebrow, title, intro, dark = false }) {
  return (
    <div data-reveal style={{ maxWidth: 640, margin: '0 auto 44px', textAlign: 'center' }}>
      <div style={{
        fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase',
        color: dark ? 'rgba(255,255,255,0.65)' : tealDeep, marginBottom: 12,
      }}>
        {eyebrow}
      </div>
      <h2 style={{
        fontFamily: theme.fontDisplay, fontWeight: 900,
        fontSize: 'clamp(1.7rem, 3.2vw, 2.6rem)', lineHeight: 1.15, letterSpacing: '-0.02em',
        color: dark ? '#fff' : textDark, margin: '0 0 14px',
      }}>
        {title}
      </h2>
      {intro && (
        <p style={{ fontSize: 15, color: dark ? 'rgba(255,255,255,0.8)' : textMid, lineHeight: 1.7, margin: 0 }}>
          {intro}
        </p>
      )}
    </div>
  )
}
