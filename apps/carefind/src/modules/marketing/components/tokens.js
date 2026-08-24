import { theme } from '../../../styles/theme'

// Shared display scale for all CareFind marketing pages (spec section 3).
export const TYPE = {
  displayXL: 'clamp(2.6rem, 5.5vw, 4.5rem)',
  displayL: 'clamp(1.9rem, 3.6vw, 2.75rem)',
  displayM: 'clamp(1.4rem, 2.6vw, 1.9rem)',
  lead: 'clamp(0.95rem, 1.4vw, 1.0625rem)',
}

// Standard art-directed photo treatment (spec section 3): one recipe, every photo.
export const DUOTONE =
  'linear-gradient(180deg, rgba(11,74,62,0.55) 0%, rgba(11,74,62,0.85) 100%)'

export { prefersReducedMotion } from './useRevealOnScroll'
export { theme }
