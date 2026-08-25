import { theme } from '../../styles/theme'

// Display scale for CareHub marketing surfaces (spec section 3). Mirrors the
// CareFind marketing module by design — spec section 4 rules that these
// primitives are duplicated per app rather than shared, so the two products'
// marketing can diverge without a versioned package release. Do NOT extract
// these into packages/design-system.
export const TYPE = {
  displayXL: 'clamp(2.6rem, 5.5vw, 4.25rem)',
  displayL: 'clamp(1.9rem, 3.4vw, 2.6rem)',
  displayM: 'clamp(1.35rem, 2.4vw, 1.8rem)',
  lead: 'clamp(0.95rem, 1.4vw, 1.0625rem)',
}

// Standard art-directed photo treatment (spec section 3): one recipe, every photo.
export const DUOTONE =
  'linear-gradient(180deg, rgba(11,74,62,0.55) 0%, rgba(11,74,62,0.85) 100%)'

export { prefersReducedMotion } from './useRevealOnScroll'
export { theme }
