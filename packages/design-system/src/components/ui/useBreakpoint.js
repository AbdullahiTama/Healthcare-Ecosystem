import { useEffect, useState } from 'react'
import { theme } from '../../theme'

// Shared responsive hook (Stage 3 / Slice 6). CareHub and CareFind each had a
// byte-near-identical useBreakpoint; this is the single source, reading the
// five-tier scale from theme.breakpoints (docs/design/GRID_SYSTEM.md) so
// "tablet" or "laptop" means the same viewport range everywhere in both apps.
// The app is built with inline styles, which can't express CSS media queries;
// this hook is the JS-side equivalent per docs/design/RESPONSIVENESS.md.
//
// CareFind's `isMobileOrTablet` convenience is included here too, so CareFind
// call sites (ResetPassword, Login, Onboarding, LiveDashboard) keep working.
const { mobile, tablet, laptop, desktop } = theme.breakpoints

function resolve(width) {
  if (width < tablet) return 'mobile'
  if (width < laptop) return 'tablet'
  if (width < desktop) return 'laptop'
  if (width < theme.breakpoints.largeDesktop) return 'desktop'
  return 'largeDesktop'
}

export function useBreakpoint() {
  const [width, setWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : desktop))

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
    isMobileOrTablet: width < laptop,
  }
}
