import { theme } from '../../../../styles/theme'
import { useBreakpoint } from '../../../../hooks/useBreakpoint'

// The shared editorial rhythm for every landing section: eyebrow, display
// heading, supporting paragraph, optional children, and a consistent vertical
// cadence with a 1400px content cap (docs/design/DESIGN_SYSTEM.md:38).
//
// Layout note: mobile stacks the heading above the content; from laptop up the
// heading sits in its own column beside the content. That is a structural
// change, not a flex-direction flip (RESPONSIVENESS.md:52).
const MAX_WIDTH = 1180
const GUTTER = 20

export function Eyebrow({ children, tone = 'light' }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: tone === 'dark' ? 'rgba(255,255,255,0.72)' : theme.tealDeep,
        marginBottom: theme.space[6],
      }}
    >
      {children}
    </div>
  )
}

export function LandingSection({
  id,
  section,
  eyebrow,
  title,
  body,
  children,
  tone = 'light',
  background = theme.bg,
  align = 'split',
  sectionRef,
  headingExtra,
}) {
  const { isMobileOrTablet } = useBreakpoint()
  const onDark = tone === 'dark'
  const centered = align === 'center'
  const stacked = centered || isMobileOrTablet

  const heading = (
    <div style={{ minWidth: 0, textAlign: centered ? 'center' : undefined }}>
      {eyebrow && <Eyebrow tone={tone}>{eyebrow}</Eyebrow>}
      <h2
        style={{
          fontFamily: theme.fontDisplay,
          fontWeight: 900,
          fontSize: 'clamp(1.7rem, 3.2vw, 2.6rem)',
          lineHeight: 1.15,
          letterSpacing: '-0.02em',
          color: onDark ? '#fff' : theme.textDark,
          margin: 0,
          textWrap: 'balance',
        }}
      >
        {title}
      </h2>
      {body && (
        <p
          style={{
            fontSize: 15,
            lineHeight: 1.7,
            color: onDark ? 'rgba(255,255,255,0.78)' : theme.textMid,
            margin: centered ? '14px auto 0' : '14px 0 0',
            maxWidth: 520,
          }}
        >
          {body}
        </p>
      )}
      {headingExtra}
    </div>
  )

  return (
    <section
      id={id}
      ref={sectionRef}
      data-section={section || id}
      style={{
        background,
        color: onDark ? '#fff' : theme.textDark,
        // GUTTER is a bare number, so it needs its unit here: `96px 20 104px`
        // is invalid CSS and the browser drops the whole declaration, which
        // removes the section's vertical rhythm and its side gutters.
        padding: `96px ${GUTTER}px 104px`,
        borderTop: onDark ? 'none' : `1px solid ${theme.hairline}`,
      }}
    >
      <div style={{ maxWidth: MAX_WIDTH, margin: '0 auto' }}>
        {stacked ? (
          <>
            <div
              data-reveal
              style={{ marginBottom: centered ? 56 : 48 }}
            >
              {heading}
            </div>
            <div data-reveal>{children}</div>
          </>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 0.85fr) minmax(0, 1.15fr)',
              gap: 48,
              alignItems: 'start',
            }}
          >
            <div data-reveal style={{ minWidth: 0 }}>{heading}</div>
            <div data-reveal style={{ minWidth: 0 }}>{children}</div>
          </div>
        )}
      </div>
    </section>
  )
}

export { MAX_WIDTH as LANDING_MAX_WIDTH, GUTTER as LANDING_GUTTER }
