import { useRef } from 'react'
import { theme } from '../../styles/theme'
import useLandingMotion from './landing/useLandingMotion'
import SiteNav from './landing/sections/SiteNav.jsx'
import Hero from './landing/sections/Hero.jsx'
import SearchShowcase from './landing/sections/SearchShowcase.jsx'
import DiscoveryFeatures from './landing/sections/DiscoveryFeatures.jsx'
import Ecosystem from './landing/sections/Ecosystem.jsx'
import ProviderShowcase from './landing/sections/ProviderShowcase.jsx'
import HowItWorks from './landing/sections/HowItWorks.jsx'
import Trust from './landing/sections/Trust.jsx'
import FinalCTA from './landing/sections/FinalCTA.jsx'
import SiteFooter from './landing/sections/SiteFooter.jsx'

// The public landing page at "/". Despite the historical filename this is the
// patient/consumer entry point; the business-facing page is /claim-business.
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
      }}
    >
      <SiteNav />
      <main>
        <Hero />
        <SearchShowcase />
        <DiscoveryFeatures />
        <Ecosystem />
        <ProviderShowcase />
        <HowItWorks />
        <Trust />
        <FinalCTA />
      </main>
      <SiteFooter />
    </div>
  )
}
