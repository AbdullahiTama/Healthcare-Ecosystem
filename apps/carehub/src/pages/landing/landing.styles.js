// The only CSS this landing page ships.
//
// The app has no Tailwind, no CSS Modules and no styled-components — the house
// style is React inline style objects reading the tokens in styles/theme, with
// a single injected <style> for the handful of things inline styles genuinely
// cannot express. This follows the existing pattern in Sheet.jsx, Toast.jsx and
// AdminDashboard.jsx, including the id guard so the block injects once.
//
// It is deliberately four rules. Everything else is an inline style.

const ID = 'carehub-landing-styles'

const CSS = `
/* 1 — Visually hidden but still announced (and still focusable when targeted).
       Used for table captions and for the section-level h2 labels. */
.ch-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* 1b — Skip link. Off-screen until a keyboard user tabs onto it, then pinned
        to the top-left so it can actually be read and clicked. Done in CSS
        rather than with onFocus/onBlur handlers so the link is never in an
        unstyled state and never needs JavaScript to be usable. */
.ch-skip {
  position: absolute;
  top: -64px;
  left: 8px;
  z-index: 200;
  padding: 12px 20px;
  background: var(--teal-deep, #0E6F5A);
  color: #ffffff;
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
  border-radius: 0 0 10px 10px;
  transition: top 200ms cubic-bezier(0.16, 1, 0.3, 1);
}
.ch-skip:focus {
  top: 0;
}

/* 2 — The global :focus-visible ring is brand teal, which is invisible on the
       two dark teal surfaces on this page. Swap it for white there. The
       attribute selector keeps specificity above the bare :focus-visible rule
       in styles/global.css. */
[data-surface='dark'] :focus-visible {
  outline-color: #ffffff;
}

/* 3 — Reduced motion. useLandingMotion already skips every tween and
       ScrollTrigger when the media query matches, so this is the backstop for
       the inline CSS transitions the nav and buttons use. */
@media (prefers-reduced-motion: reduce) {
  .ch-landing-root,
  .ch-landing-root * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    transition-delay: 0ms !important;
    scroll-behavior: auto !important;
  }
}
`

export function injectLandingStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(ID)) return
  const el = document.createElement('style')
  el.id = ID
  el.textContent = CSS
  document.head.appendChild(el)
}

injectLandingStyles()
