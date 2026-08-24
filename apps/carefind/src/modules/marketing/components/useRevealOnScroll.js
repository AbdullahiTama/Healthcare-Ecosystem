import { useEffect } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
}

// Canonical reveal-on-scroll for marketing pages. No-op when the user prefers
// reduced motion — content simply renders in place (About.jsx precedent).
export function useRevealOnScroll(scopeRef, { selector = '[data-reveal]', y = 30 } = {}) {
  useEffect(() => {
    if (!scopeRef.current || prefersReducedMotion()) return undefined
    const ctx = gsap.context(() => {
      gsap.utils.toArray(selector).forEach((el) => {
        gsap.from(el, {
          y, opacity: 0, duration: 0.8, ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 88%' },
        })
      })
    }, scopeRef)
    return () => ctx.revert()
  }, [scopeRef, selector, y])
}
