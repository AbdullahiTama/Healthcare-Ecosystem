import { useBreakpoint } from '../../../hooks/useBreakpoint'

// Section rhythm. Vertical padding steps down across the five tiers
// useBreakpoint reports, and the side gutter grows with the viewport so text
// never runs edge to edge on a 1440px screen.
export const SECTION_PAD = {
  mobile: '64px 24px',
  tablet: '80px 32px',
  laptop: '104px 40px',
  desktop: '144px 40px',
}

const SURFACE = {
  bg: 'var(--bg)',
  panel: 'var(--panel)',
  white: '#ffffff',
  dark: 'linear-gradient(155deg, #0E6F5A 0%, #0B4A3E 62%, #0B4A3E 100%)',
}

export function useSectionPad() {
  const { breakpoint } = useBreakpoint()
  return SECTION_PAD[breakpoint] || SECTION_PAD.desktop
}

export function Section({
  id,
  labelledBy,
  surface = 'bg',
  width = 1200,
  pad,
  children,
  style,
}) {
  const defaultPad = useSectionPad()
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      data-surface={surface === 'dark' ? 'dark' : 'light'}
      style={{
        padding: pad || defaultPad,
        background: SURFACE[surface] || SURFACE.bg,
        // The nav is sticky at 68px. Without this offset, jumping to #pricing
        // or #features parks the section heading underneath it.
        scrollMarginTop: '84px',
        ...style,
      }}
    >
      <div style={{ maxWidth: width, margin: '0 auto', width: '100%' }}>{children}</div>
    </section>
  )
}
