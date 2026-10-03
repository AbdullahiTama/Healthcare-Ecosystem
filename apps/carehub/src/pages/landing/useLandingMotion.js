import { useEffect } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

const EASE = 'power3.out'
const START = 'top 85%'

// One owner for every animation on the page.
//
// The previous Landing.jsx ran 13 separate gsap.from blocks with 1.2s durations
// and 60px of travel, none of them guarded against prefers-reduced-motion. This
// is the restrained version: at most 24px of travel, 0.6-0.7s, once, no scrub,
// no parallax, no continuous motion.
//
// Sections opt in declaratively rather than being handed refs:
//   data-reveal-group  — container that triggers its children
//   data-reveal="load" — plays immediately on mount (the hero)
//   data-reveal        — plays when its group scrolls into view
//
// When reduced motion is preferred this returns before creating a single tween,
// so the markup renders in its natural, final, fully visible state.
export function useLandingMotion(rootRef, prefersReducedMotion) {
  useEffect(() => {
    const root = rootRef.current
    if (!root || prefersReducedMotion) return

    const ctx = gsap.context(() => {
      const onLoad = root.querySelectorAll('[data-reveal="load"]')
      if (onLoad.length) {
        gsap.from(onLoad, {
          y: 20,
          opacity: 0,
          duration: 0.7,
          stagger: 0.06,
          ease: EASE,
          clearProps: 'transform,opacity',
        })
      }

      root.querySelectorAll('[data-reveal-group]').forEach((group) => {
        const items = group.querySelectorAll('[data-reveal]')
        if (!items.length) return
        gsap.from(items, {
          scrollTrigger: { trigger: group, start: START, once: true },
          y: 24,
          opacity: 0,
          duration: 0.6,
          stagger: 0.05,
          ease: EASE,
          clearProps: 'transform,opacity',
        })
      })

      ScrollTrigger.refresh()
    }, root)

    return () => ctx.revert()
  }, [rootRef, prefersReducedMotion])
}
