import { useRef } from 'react'
import { theme } from '../../styles/theme'
import useLandingMotion from './landing/useLandingMotion'
import SiteNav from './landing/sections/SiteNav.jsx'
import Hero from './landing/sections/Hero.jsx'
import HowItWorks from './landing/sections/HowItWorks.jsx'
import Capabilities from './landing/sections/Capabilities.jsx'
import FinalCTA from './landing/sections/FinalCTA.jsx'
import SiteFooter from './landing/sections/SiteFooter.jsx'

// The public landing page at "/". Despite the historical filename this is the
// patient/consumer entry point; the business-facing page is /claim-business.
//
// The page is deliberately short: a photographic hero that carries the feature
// strip and the capability strip inside the first viewport, then How it works,
// What you can do, and one closing call to action. Everything above the fold
// sells the product; nothing below it repeats what the hero already said.
//
// All copy, routes and illustrative fixtures live in
// landing/data/landingContent.js, which carries the honesty rules this page is
// held to — in particular, no partner names, no testimonials, no usage
// statistics, and no "verified" claim for businesses that the schema does not
// back. All motion lives in landing/useLandingMotion.js, which is a single GSAP
// context with a reduced-motion guard that runs before anything is built.
export default function ForBusiness() {
  const pageRef = useRef(null)
  useLandingMotion(pageRef)

  return (
    <div
      ref={pageRef}
      style={{
        fontFamily: theme.fontFamily,
        background: theme.bg,
        color: theme.textDark,
        minHeight: '100vh',
        // Guards every section against a wide child forcing a horizontal
        // scrollbar at 375px. Nothing in the page is meant to overflow.
        overflowX: 'hidden',
        maxWidth: '100%',
        position: 'relative',
      }}
    >
      <SiteNav />
      <main>
        <Hero />
        <HowItWorks />
        <Capabilities />
        <FinalCTA />
      </main>
      <SiteFooter />
    </div>
  )
}
