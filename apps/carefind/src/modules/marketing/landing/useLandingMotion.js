import { useEffect } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

// One GSAP context for the whole landing page.
//
// Every reveal is scroll-triggered — there is no page-load stagger, per
// docs/design/MOTION.md:46 ("no animation on page load beyond content
// appearing"). Durations are capped at 0.3s (MOTION.md:16) and easing is
// power2.out — no bounce, no spring-overshoot (MOTION.md:22).
//
// The reduced-motion check happens BEFORE the context is created, so under
// `prefers-reduced-motion: reduce` nothing is ever built and nothing is left
// in a half-animated state. (About.jsx:117-129 has this check misplaced — it
// runs after the hero animation, which therefore plays regardless.)
const DURATION = 0.3
const RISE = 16
const STAGGER = 0.05

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
}

export default function useLandingMotion(scopeRef) {
  useEffect(() => {
    if (prefersReducedMotion()) return

    const ctx = gsap.context(() => {
      // Hero: content appearing, once, on load. No stagger across the hero.
      gsap.from('[data-hero]', {
        y: RISE,
        opacity: 0,
        duration: DURATION,
        ease: 'power2.out',
      })

      // Every section marked data-reveal fades up as it enters the viewport.
      gsap.utils.toArray('[data-reveal]').forEach((el) => {
        gsap.from(el, {
          y: RISE,
          opacity: 0,
          duration: DURATION,
          ease: 'power2.out',
          scrollTrigger: { trigger: el, start: 'top 90%' },
        })
      })

      // Grouped children (bento cells, category tiles, trust rows) get a small
      // cascade within their own group rather than one page-wide stagger.
      gsap.utils.toArray('[data-reveal-group]').forEach((group) => {
        const items = group.children
        if (!items?.length) return
        gsap.from(items, {
          y: 12,
          opacity: 0,
          duration: DURATION,
          ease: 'power2.out',
          stagger: STAGGER,
          scrollTrigger: { trigger: group, start: 'top 90%' },
        })
      })

      // Product preview reveal — the product arriving after the headline.
      gsap.utils.toArray('[data-reveal-product]').forEach((el) => {
        gsap.from(el, {
          y: 20,
          opacity: 0,
          duration: DURATION,
          ease: 'power2.out',
          scrollTrigger: { trigger: el, start: 'top 88%' },
        })
      })
    }, scopeRef)

    // ctx.revert() removes every tween and ScrollTrigger this context created,
    // so navigating away from the landing page leaves nothing running.
    return () => ctx.revert()
  }, [scopeRef])
}
