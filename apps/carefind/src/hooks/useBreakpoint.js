import { useEffect, useState } from 'react'
import { theme } from '../styles/theme'

const { mobile, tablet, laptop, desktop } = theme.breakpoints

function resolve(width) {
  if (width < tablet) return 'mobile'
  if (width < laptop) return 'tablet'
  if (width < desktop) return 'laptop'
  if (width < theme.breakpoints.largeDesktop) return 'desktop'
  return 'largeDesktop'
}

// The app is built with inline styles, which can't express CSS media queries.
// This hook is the JS-side equivalent, letting components branch per
// docs/design/RESPONSIVENESS.md and docs/design/GRID_SYSTEM.md's five
// breakpoints without a CSS-in-JS or Tailwind dependency.
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
    // Convenience: most CareFind components only need a two-way split.
    isMobileOrTablet: width < laptop,
  }
}
