import { theme } from '../../styles/theme'

const { tealDeep, textDark, gray500 } = theme

// Eyebrow + title + intro block above every marketing section. CareHub headings
// use fontWeight 700 and gray500 body copy, per its established landing styling.
export default function SectionHeading({ eyebrow, title, intro, dark = false }) {
  return (
    <div data-reveal style={{ maxWidth: 640, margin: '0 auto 44px', textAlign: 'center' }}>
      {eyebrow && (
        <div style={{
          fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase',
          color: dark ? 'rgba(255,255,255,0.65)' : tealDeep, marginBottom: 12,
        }}>
          {eyebrow}
        </div>
      )}
      <h2 style={{
        fontFamily: theme.fontDisplay, fontWeight: 700,
        fontSize: 'clamp(1.7rem, 3.2vw, 2.6rem)', lineHeight: 1.2, letterSpacing: '-0.02em',
        color: dark ? '#fff' : textDark, margin: '0 0 14px',
      }}>
        {title}
      </h2>
      {intro && (
        <p style={{ fontSize: 14, color: dark ? 'rgba(255,255,255,0.8)' : gray500, lineHeight: 1.7, margin: 0 }}>
          {intro}
        </p>
      )}
    </div>
  )
}
