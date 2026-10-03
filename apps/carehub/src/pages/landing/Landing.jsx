import { useRef } from 'react'
import './landing.styles'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'
import { useLandingMotion } from './useLandingMotion'

import { NavBar } from './sections/NavBar'
import { Hero } from './sections/Hero'
import { BusinessTypesStrip } from './sections/BusinessTypesStrip'
import { ProductShowcase } from './sections/ProductShowcase'
import { FeaturesBento } from './sections/FeaturesBento'
import { BuiltFor } from './sections/BuiltFor'
import { WorkflowSection } from './sections/WorkflowSection'
import { CapabilitiesSection } from './sections/CapabilitiesSection'
import { PricingSection } from './sections/PricingSection'
import { FinalCta } from './sections/FinalCta'
import { SiteFooter } from './sections/SiteFooter'

// Section order is the argument the page makes, top to bottom:
//   what it is -> proof it is real -> what it does -> what it does for you
//   -> how you start -> how big it is -> what it costs -> do it.
// The old page ran fourteen same-weight sections with no shape, so nothing
// built on anything.
export function Landing() {
  const rootRef = useRef(null)
  const prefersReducedMotion = usePrefersReducedMotion()
  useLandingMotion(rootRef, prefersReducedMotion)

  return (
    <div className="ch-landing-root" ref={rootRef} style={{ background: 'var(--bg)' }}>
      <a className="ch-skip" href="#main">
        Skip to main content
      </a>

      <NavBar />

      <main id="main">
        <Hero />
        <BusinessTypesStrip />
        <ProductShowcase />
        <FeaturesBento />
        <BuiltFor />
        <WorkflowSection />
        <CapabilitiesSection />
        <PricingSection />
        <FinalCta />
      </main>

      <SiteFooter />
    </div>
  )
}

export default Landing
