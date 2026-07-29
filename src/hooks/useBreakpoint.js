import { useEffect, useState } from 'react'

// CareHub had no responsive infrastructure at all before this — this hook is
// the CareHub-side twin of CareFind's own useBreakpoint, using the exact same
// five-tier scale from docs/design/GRID_SYSTEM.md (shared across both
// products) so "tablet" or "laptop" means the same viewport range everywhere
// in the codebase. CareHub is desktop-first (docs/design/RESPONSIVENESS.md):
// this hook exists so the app can gracefully *degrade* toward smaller widths
// (collapsed sidebar, single-column) rather than build up from mobile the
// way CareFind's does.
const BREAKPOINTS = { mobile: 320, tablet: 768, laptop: 1024, desktop: 1440, largeDesktop: 1920 }

function resolve(width) {
  if (width < BREAKPOINTS.tablet) return 'mobile'
  if (width < BREAKPOINTS.laptop) return 'tablet'
  if (width < BREAKPOINTS.desktop) return 'laptop'
  if (width < BREAKPOINTS.largeDesktop) return 'desktop'
  return 'largeDesktop'
}

export function useBreakpoint() {
  const [width, setWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : BREAKPOINTS.desktop))

  useEffect(() => {
    let frame = null
    const onResize = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        setWidth(window.innerWidth)
        frame = null
      })
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  const breakpoint = resolve(width)

  return {
    width,
    breakpoint,
    isMobile: breakpoint === 'mobile',
    isTablet: breakpoint === 'tablet',
    isLaptop: breakpoint === 'laptop',
    isDesktop: breakpoint === 'desktop' || breakpoint === 'largeDesktop',
  }
}
