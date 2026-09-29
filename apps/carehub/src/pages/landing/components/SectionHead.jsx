import { theme } from '../../../styles/theme'
import { Eyebrow } from './Eyebrow'
import { useSectionPad } from './Section'

// Every section opens the same way: eyebrow, then one h2, then one lead
// paragraph. Enforcing that order in a component is what stops the page
// flattening into the current version's fourteen same-shaped sections.
export function SectionHead({
  id,
  eyebrow,
  title,
  lead,
  onDark = false,
  align = 'center',
  leadWidth = 620,
  style,
}) {
  const centered = align === 'center'
  // The gap under a head steps down on phones, where 56px of dead space above a
  // 28px heading reads as a mistake rather than as generosity.
  const pad = useSectionPad()
  const headGap = pad.startsWith('64px') ? '36px' : '56px'

  return (
    <div
      data-reveal
      style={{
        maxWidth: lead ? leadWidth + 160 : 760,
        margin: centered ? '0 auto' : 0,
        textAlign: centered ? 'center' : 'left',
        marginBottom: headGap,
        ...style,
      }}
    >
      <div style={{ marginBottom: 20 }}>
        <Eyebrow onDark={onDark}>{eyebrow}</Eyebrow>
      </div>
      <h2
        id={id}
        style={{
          fontFamily: theme.fontDisplay,
          fontWeight: 700,
          fontSize: 'clamp(28px, 3.2vw, 40px)',
          lineHeight: 1.12,
          letterSpacing: '-0.025em',
          color: onDark ? '#ffffff' : theme.navy,
          margin: '0 0 16px',
          textWrap: 'balance',
        }}
      >
        {title}
      </h2>
      {lead && (
        <p
          style={{
            fontSize: 16,
            lineHeight: 1.65,
            fontWeight: 500,
            color: onDark ? 'rgba(255,255,255,0.85)' : theme.gray600,
            maxWidth: leadWidth,
            margin: centered ? '0 auto' : 0,
            textWrap: 'pretty',
          }}
        >
          {lead}
        </p>
      )}
    </div>
  )
}
